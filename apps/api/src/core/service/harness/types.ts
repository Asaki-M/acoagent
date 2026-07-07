import type { CodeFile } from "../../types/chat.js";
import type { WorkMemoryToolName } from "../../memory/tools.js";

// 当前 harness 支持的模型 provider 名称。
export type ModelProviderName = "vertex" | "openai" | "mock";

// 传给模型 provider 的标准消息格式。
export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// 主对话请求的统一结构，provider 适配器都消费这个类型。
export type ModelRequest = {
  provider: ModelProviderName;
  model: string;
  projectName: string;
  projectPath: string;
  sessionId: string;
  question: string;
  files: CodeFile[];
  messages: ModelMessage[];
  temperature: number;
  maxOutputTokens: number;
};

// 模型在工作记忆维护阶段返回的工具调用。
export type MemoryToolCall = {
  name: WorkMemoryToolName;
  arguments: Record<string, unknown>;
};

// 工作记忆维护规划所需的上下文。
export type MemoryMaintenanceRequest = {
  model: string;
  projectName: string;
  projectPath: string;
  sessionId: string;
  question: string;
  answer: string;
  workMemory: string;
};

// provider 原始输出的统一 chunk，随后会被 harness 转成前端事件。
export type ModelStreamChunk =
  | {
      type: "delta";
      content: string;
    }
  | {
      type: "trace";
      name: string;
      detail: string;
    }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
    };

// 模型 provider 适配器接口。
export type ModelProvider = {
  name: ModelProviderName;
  defaultModel: string;
  isConfigured(): boolean;
  stream(request: ModelRequest): AsyncGenerator<ModelStreamChunk>;
  planMemoryMaintenance?(request: MemoryMaintenanceRequest): Promise<MemoryToolCall[]>;
};
