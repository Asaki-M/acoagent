import { Hono } from "hono";
import { cors } from "hono/cors";
import { buildCodeQuestionRequest } from "../service/harness/context.js";
import { ModelHarness } from "../service/harness/model-harness.js";
import { executeMemoryToolCalls } from "../memory/tools.js";
import { MemoryStore } from "../memory/store.js";
import { createDefaultTools, ToolNotFoundError, ToolPool, ToolValidationError } from "../tools/index.js";
import { normalizeJsonObject } from "../tools/utils/json.js";
import { makeTrace, writeSse } from "../transport/sse.js";
import type { ChatRequestBody } from "../types/chat.js";
import { normalizeScope } from "./utils/scope.js";
import { writeTraceSse } from "./utils/traces.js";

const harness = ModelHarness.fromEnv();
const memoryStore = new MemoryStore();
const toolPool = new ToolPool();
toolPool.registerMany(createDefaultTools(memoryStore));

export function createApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: process.env.WEB_ORIGIN || "http://localhost:3000",
      allowHeaders: ["Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  app.get("/health", (context) =>
    context.json({
      ok: true,
      service: "ai-platform-api",
      defaultProvider: process.env.MODEL_PROVIDER || "vertex",
    }),
  );

  app.get("/api/sessions", (context) => {
    const projectPath = context.req.query("projectPath");
    return context.json({
      sessions: memoryStore.listSessions(projectPath),
    });
  });

  app.post("/api/sessions", async (context) => {
    const body = (await context.req.json()) as Pick<ChatRequestBody, "projectName" | "projectPath" | "sessionId">;
    const scope = normalizeScope(body);

    memoryStore.ensureSession(scope);
    const trace = makeTrace("session.create", "done", "Created a new project-scoped memory session.");
    memoryStore.addTrace(scope, trace);

    return context.json({
      session: memoryStore.listSessions(scope.projectPath).find((session) => session.sessionId === scope.sessionId),
      trace,
    });
  });

  app.get("/api/history", (context) => {
    const projectName = context.req.query("projectName") || "Local project";
    const projectPath = context.req.query("projectPath") || projectName;
    const sessionId = context.req.query("sessionId") || "default";
    const scope = { projectName, projectPath, sessionId };

    memoryStore.ensureSession(scope);
    return context.json({
      messages: memoryStore.getMessages(scope),
      steps: memoryStore.getSteps(scope),
      traces: memoryStore.getTraces(scope),
      workMemory: memoryStore.getWorkMemory(scope),
    });
  });

  app.get("/api/tools", async (context) => {
    return context.json({
      tools: toolPool.listTools(),
    });
  });

  app.post("/api/tools/search", async (context) => {
    const body = (await context.req.json()) as { query?: string; topK?: number };
    const query = body.query?.trim();

    if (!query) {
      return context.json({ message: "Query is required." }, 400);
    }

    try {
      return context.json({
        tools: await toolPool.searchTools(query, body.topK),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool search failed.";
      return context.json({ message }, 503);
    }
  });

  app.post("/api/tools/call", async (context) => {
    const body = (await context.req.json()) as ChatRequestBody & {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    const name = body.name?.trim();

    if (!name) {
      return context.json({ message: "Tool name is required." }, 400);
    }

    try {
      const result = await toolPool.callTool(name, normalizeJsonObject(body.arguments), normalizeScope(body));
      return context.json(result);
    } catch (error) {
      if (error instanceof ToolNotFoundError) {
        return context.json({ message: error.message }, 404);
      }

      if (error instanceof ToolValidationError) {
        return context.json({ message: error.message }, 400);
      }

      throw error;
    }
  });

  app.post("/api/chat", async (context) => {
    const body = (await context.req.json()) as ChatRequestBody;

    if (!body.question?.trim()) {
      return context.json({ message: "Question is required." }, 400);
    }

    const scope = normalizeScope(body);

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
            const appliedTools = await executeMemoryToolCalls(memoryStore, scope, calls);
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

  return app;
}
