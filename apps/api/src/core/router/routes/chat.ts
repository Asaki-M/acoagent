import { executeWorkMemoryMaintenanceToolCalls } from "../../memory/tools.js";
import { buildCodeQuestionRequest } from "../../service/harness/context.js";
import { writeSse } from "../../transport/sse.js";
import type { ChatRequestBody } from "../../types/chat.js";
import { normalizeScope } from "../utils/scope.js";
import { writeTraceSse } from "../utils/traces.js";
import type { AppRouter, RouterDependencies } from "./types.js";

export function registerChatRoutes(
  app: AppRouter,
  { harness, memoryStore }: Pick<RouterDependencies, "harness" | "memoryStore">,
) {
  app.post("/api/chat", async (context) => {
    const body = (await context.req.json()) as ChatRequestBody;

    if (!body.question?.trim()) {
      return context.json({ message: "Question is required." }, 400);
    }

    const scope = normalizeScope(body);

    // 进入模型前先读取记忆：短期记忆由最近消息窗口组成，工作记忆直接注入 system prompt。
    const workMemory = memoryStore.getWorkMemory(scope);
    const shortTermMessages = memoryStore.getShortTermMessages(scope, 5);
    const userMessageId = memoryStore.addMessage(scope, "user", body.question.trim());
    const stepId = memoryStore.createStep(scope, userMessageId, body.question.trim());
    const modelRequest = buildCodeQuestionRequest(body, {
      shortTermMessages,
      workMemory,
    });
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    let assistantAnswer = "";

    void (async () => {
      try {
        await writeTraceSse({
          writer,
          encoder,
          memoryStore,
          scope,
          name: "hono.request",
          status: "done",
          detail: `Accepted ${modelRequest.files.length} files for code Q&A.`,
        });
        await writeTraceSse({
          writer,
          encoder,
          memoryStore,
          scope,
          name: "step.create",
          status: "done",
          detail: `Started step ${stepId}.`,
        });

        // 将模型事件流转发为 SSE，同时累积完整助手回答用于后续持久化。
        for await (const event of harness.stream(modelRequest)) {
          if (event.type === "delta") {
            assistantAnswer += event.content;
            await writeSse(writer, encoder, "delta", { content: event.content });
          }

          if (event.type === "trace") {
            await writeTraceSse({
              writer,
              encoder,
              memoryStore,
              scope,
              name: event.name,
              status: event.status ?? "done",
              detail: event.detail,
            });
          }

          if (event.type === "done") {
            const assistantMessageId = memoryStore.addMessage(scope, "assistant", assistantAnswer);
            memoryStore.completeStep(scope, stepId, assistantMessageId);
            await writeTraceSse({
              writer,
              encoder,
              memoryStore,
              scope,
              name: "step.complete",
              status: "done",
              detail: `Completed step ${stepId}.`,
            });
            // 主回答完成后单独规划工作记忆维护，再由后端执行实际工具调用。
            const calls = await harness.planMemoryMaintenance({
              provider: modelRequest.provider,
              model: modelRequest.model,
              projectName: modelRequest.projectName,
              projectPath: modelRequest.projectPath,
              sessionId: modelRequest.sessionId,
              question: modelRequest.question,
              answer: assistantAnswer,
              workMemory,
            });
            const appliedTools = await executeWorkMemoryMaintenanceToolCalls(memoryStore, scope, calls);
            await writeTraceSse({
              writer,
              encoder,
              memoryStore,
              scope,
              name: "memory.maintenance",
              status: "done",
              detail: appliedTools.length
                ? `Applied ${appliedTools.join(", ")}.`
                : "No durable work memory changes were needed.",
            });
            await writeSse(writer, encoder, "done", { ok: true });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown chat error.";
        memoryStore.failStep(scope, stepId);
        await writeTraceSse({
          writer,
          encoder,
          memoryStore,
          scope,
          name: "hono.error",
          status: "error",
          detail: message,
        });
        await writeSse(writer, encoder, "error", { message });
      } finally {
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    });
  });
}
