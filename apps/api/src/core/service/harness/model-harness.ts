import type {
  MemoryMaintenanceRequest,
  MemoryToolCall,
  ModelProvider,
  ModelProviderName,
  ModelRequest,
  ModelStreamChunk,
} from "./types.js";
import { createMockProvider } from "../../manager/providers/mock-provider.js";
import { createOpenAIProvider } from "../../manager/providers/openai-provider.js";
import { createVertexProvider } from "../../manager/providers/vertex-provider.js";

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

export class ModelHarness {
  private readonly providers: Map<ModelProviderName, ModelProvider>;
  private readonly fallbackProvider: ModelProvider;

  constructor(providers: ModelProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.name, provider]));
    this.fallbackProvider = this.providers.get("mock") ?? createMockProvider();
  }

  static fromEnv() {
    return new ModelHarness([createVertexProvider(), createOpenAIProvider(), createMockProvider()]);
  }

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

  async planMemoryMaintenance(request: MemoryMaintenanceRequest & { provider: ModelProviderName }): Promise<MemoryToolCall[]> {
    const provider = this.resolveProvider(request.provider);
    if (!provider.planMemoryMaintenance) return [];

    return provider.planMemoryMaintenance({
      ...request,
      model: provider.name === request.provider ? request.model : provider.defaultModel,
    });
  }

  private resolveProvider(name: ModelProviderName) {
    const requested = this.providers.get(name);
    if (requested?.isConfigured()) return requested;

    return this.fallbackProvider;
  }

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
