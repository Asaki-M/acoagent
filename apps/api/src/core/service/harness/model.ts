import type {
  MemoryMaintenanceRequest,
  MemoryToolCall,
  ModelProvider,
  ModelProviderName,
  ModelRequest,
  ModelStreamChunk,
} from "./types.js";
import { createMockProvider } from "../../manager/providers/mock.js";
import { createOpenAIProvider } from "../../manager/providers/openai.js";
import { createVertexProvider } from "../../manager/providers/vertex.js";

// Harness 对外统一输出的事件流，屏蔽不同模型 provider 的差异。
export type HarnessEvent =
  | {
      type: "delta";
      content: string;
    }
  | {
      type: "trace";
      name: string;
      detail: string;
      status?: "queued" | "running" | "done" | "error";
    }
  | {
      type: "done";
    };

// 模型调度器：负责选择可用 provider、统一流式输出，并处理记忆维护规划。
export class ModelHarness {
  private readonly providers: Map<ModelProviderName, ModelProvider>;
  private readonly fallbackProvider: ModelProvider;

  constructor(providers: ModelProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.name, provider]));
    this.fallbackProvider = this.providers.get("mock") ?? createMockProvider();
  }

  // 从环境变量可配置的 provider 列表创建默认 harness。
  static fromEnv() {
    return new ModelHarness([createVertexProvider(), createOpenAIProvider(), createMockProvider()]);
  }

  // 执行主对话请求，并把 provider 原始事件归一化成 HarnessEvent。
  async *stream(request: ModelRequest): AsyncGenerator<HarnessEvent> {
    const provider = this.resolveProvider(request.provider);
    const activeRequest = {
      ...request,
      provider: provider.name,
      model: provider.name === request.provider && request.model ? request.model : provider.defaultModel,
    };

    yield {
      type: "trace",
      name: "harness.provider",
      status: "done",
      detail: `Using ${provider.name} with model ${activeRequest.model}.`,
    };

    for await (const chunk of provider.stream(activeRequest)) {
      yield this.normalizeChunk(chunk);
    }

    yield { type: "done" };
  }

  // 回答完成后请求 provider 规划是否需要更新工作记忆。
  async planMemoryMaintenance(request: MemoryMaintenanceRequest & { provider: ModelProviderName }): Promise<MemoryToolCall[]> {
    const provider = this.resolveProvider(request.provider);
    if (!provider.planMemoryMaintenance) return [];

    return provider.planMemoryMaintenance({
      ...request,
      model: provider.name === request.provider ? request.model : provider.defaultModel,
    });
  }

  // 选择已配置的 provider；不可用时回退到 mock。
  private resolveProvider(name: ModelProviderName) {
    const requested = this.providers.get(name);
    if (requested?.isConfigured()) return requested;

    return this.fallbackProvider;
  }

  // 将 provider 事件转换成前端消费的统一事件格式。
  private normalizeChunk(chunk: ModelStreamChunk): HarnessEvent {
    if (chunk.type === "delta") {
      return chunk;
    }

    if (chunk.type === "usage") {
      return {
        type: "trace",
        name: "harness.usage",
        status: "done",
        detail: `Input tokens: ${chunk.inputTokens ?? "n/a"}, output tokens: ${chunk.outputTokens ?? "n/a"}.`,
      };
    }

    return {
      type: "trace",
      name: chunk.name,
      status: "done",
      detail: chunk.detail,
    };
  }
}
