import type { CodeFile } from "../../types/chat.js";
import type { MemoryToolName } from "../../memory/tools.js";

export type ModelProviderName = "vertex" | "openai" | "mock";

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

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

export type MemoryToolCall = {
  name: MemoryToolName;
  arguments: Record<string, unknown>;
};

export type MemoryMaintenanceRequest = {
  model: string;
  projectName: string;
  projectPath: string;
  sessionId: string;
  question: string;
  answer: string;
  workMemory: string;
};

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

export type ModelProvider = {
  name: ModelProviderName;
  defaultModel: string;
  isConfigured(): boolean;
  stream(request: ModelRequest): AsyncGenerator<ModelStreamChunk>;
  planMemoryMaintenance?(request: MemoryMaintenanceRequest): Promise<MemoryToolCall[]>;
};
