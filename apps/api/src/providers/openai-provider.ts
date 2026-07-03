import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type {
  MemoryMaintenanceRequest,
  MemoryToolCall,
  ModelProvider,
  ModelRequest,
  ModelStreamChunk,
} from "../harness/types.js";
import { buildMemoryMaintenancePrompt, memoryToolDeclarations } from "../memory/tools.js";

export function createOpenAIProvider(): ModelProvider {
  return {
    name: "openai",
    defaultModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    isConfigured() {
      return Boolean(process.env.OPENAI_API_KEY);
    },
    async *stream(request: ModelRequest): AsyncGenerator<ModelStreamChunk> {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is required for the OpenAI provider.");
      }

      yield {
        type: "trace",
        name: "openai.chat.completions",
        detail: "Streaming via retained OpenAI provider adapter.",
      };

      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const stream = await client.chat.completions.create({
        model: request.model,
        stream: true,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })) as ChatCompletionMessageParam[],
      });

      for await (const part of stream) {
        const content = part.choices[0]?.delta?.content;
        if (content) {
          yield { type: "delta", content };
        }
      }
    },
    async planMemoryMaintenance(request: MemoryMaintenanceRequest): Promise<MemoryToolCall[]> {
      if (!process.env.OPENAI_API_KEY) return [];

      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await client.chat.completions.create({
        model: request.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You maintain durable work memory for a coding assistant. Call a tool only when memory should be read, updated, or cleared.",
          },
          {
            role: "user",
            content: buildMemoryMaintenancePrompt(request),
          },
        ],
        tools: memoryToolDeclarations().map((tool) => ({
          type: "function",
          function: tool,
        })),
        tool_choice: "auto",
      });

      return (
        response.choices[0]?.message.tool_calls
          ?.map((toolCall) => {
            if (toolCall.type !== "function") return undefined;
            return {
              name: toolCall.function.name,
              arguments: parseJsonObject(toolCall.function.arguments),
            };
          })
          .filter(isMemoryToolCall) ?? []
      );
    },
  };
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isMemoryToolCall(call: { name: string; arguments: Record<string, unknown> } | undefined): call is MemoryToolCall {
  return (
    Boolean(call) &&
    (call?.name === "get_work_memory" || call?.name === "update_work_memory" || call?.name === "clear_work_memory")
  );
}
