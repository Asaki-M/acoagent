import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import type { GenerateContentResponseUsageMetadata } from "@google/genai";
import type {
  MemoryMaintenanceRequest,
  MemoryToolCall,
  ModelProvider,
  ModelRequest,
  ModelStreamChunk,
} from "../harness/types.js";
import { buildMemoryMaintenancePrompt, memoryToolDeclarations } from "../memory/tools.js";

export function createVertexProvider(): ModelProvider {
  const project = process.env.VERTEX_AI_PROJECT;
  const location = process.env.VERTEX_AI_LOCATION || "us-central1";

  return {
    name: "vertex",
    defaultModel: process.env.VERTEX_AI_MODEL || "gemini-2.5-flash",
    isConfigured() {
      return Boolean(project);
    },
    async *stream(request: ModelRequest): AsyncGenerator<ModelStreamChunk> {
      if (!project) {
        throw new Error("VERTEX_AI_PROJECT is required for the Vertex provider.");
      }

      yield {
        type: "trace",
        name: "vertex.configure",
        detail: `Project ${project}, location ${location}.`,
      };

      const client = new GoogleGenAI({
        enterprise: true,
        project,
        location,
      });

      yield {
        type: "trace",
        name: "genai.generateContentStream",
        detail: "Streaming normalized code Q&A request.",
      };

      const systemInstruction = request.messages.find((message) => message.role === "system")?.content ?? "";
      const userMessage = request.messages.findLast((message) => message.role === "user")?.content ?? request.question;
      const stream = await client.models.generateContentStream({
        model: request.model,
        contents: userMessage,
        config: {
          systemInstruction,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
        },
      });

      let usageMetadata: GenerateContentResponseUsageMetadata | undefined;
      for await (const chunk of stream) {
        usageMetadata = chunk.usageMetadata ?? usageMetadata;
        if (chunk.text) yield { type: "delta", content: chunk.text };
      }

      yield {
        type: "usage",
        inputTokens: usageMetadata?.promptTokenCount,
        outputTokens: usageMetadata?.candidatesTokenCount,
      };
    },
    async planMemoryMaintenance(request: MemoryMaintenanceRequest): Promise<MemoryToolCall[]> {
      if (!project) return [];

      const client = new GoogleGenAI({
        enterprise: true,
        project,
        location,
      });

      const response = await client.models.generateContent({
        model: request.model,
        contents: buildMemoryMaintenancePrompt(request),
        config: {
          temperature: 0,
          systemInstruction:
            "You maintain durable work memory for a coding assistant. Call a tool only when memory should be read, updated, or cleared.",
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.AUTO,
            },
          },
          tools: [
            {
              functionDeclarations: memoryToolDeclarations().map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: tool.parameters,
              })),
            },
          ],
        },
      });

      return (
        response.functionCalls
          ?.map((call) => ({
            name: call.name,
            arguments: call.args && typeof call.args === "object" ? call.args : {},
          }))
          .filter(isMemoryToolCall) ?? []
      );
    },
  };
}

function isMemoryToolCall(call: { name?: string; arguments: Record<string, unknown> }): call is MemoryToolCall {
  return (
    call.name === "get_work_memory" || call.name === "update_work_memory" || call.name === "clear_work_memory"
  );
}
