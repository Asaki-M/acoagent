import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type {
  MemoryMaintenanceRequest,
  MemoryToolCall,
  ModelProvider,
  ModelRequest,
  ModelStreamChunk,
} from "../../service/harness/types.js";
import {
  buildWorkMemoryMaintenancePrompt,
  createWorkMemoryMaintenanceToolDeclarations,
} from "../../memory/tools.js";
import { parseJsonObject } from "./utils/json.js";
import { isMemoryToolCall } from "./utils/memory-tool-calls.js";

// 创建 OpenAI 模型适配器，负责把统一请求转换成 OpenAI Chat Completions 调用。
export function createOpenAIProvider(): ModelProvider {
  return {
    name: "openai",
    defaultModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    // 判断 OpenAI provider 是否具备调用凭证。
    isConfigured() {
      return Boolean(process.env.OPENAI_API_KEY);
    },
    // 发起主对话流式请求，并把增量文本转换成统一 chunk。
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
    // 使用 OpenAI function calling 规划工作记忆是否需要更新。
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
            content: buildWorkMemoryMaintenancePrompt(request),
          },
        ],
        tools: createWorkMemoryMaintenanceToolDeclarations().map((tool) => ({
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
