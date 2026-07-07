import type { MemoryMaintenanceRequest, ModelProvider, ModelRequest, ModelStreamChunk } from "../../service/harness/types.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMockProvider(): ModelProvider {
  return {
    name: "mock",
    defaultModel: "mock-code-assistant",
    isConfigured() {
      return true;
    },
    async *stream(request: ModelRequest): AsyncGenerator<ModelStreamChunk> {
      yield {
        type: "trace",
        name: "mock.local_stream",
        detail: "Cloud model credentials are not configured; using local harness demo stream.",
      };

      const chunks = [
        `The model harness received **${request.files.length} files** from ${request.projectName}.\n\n`,
        "Vertex AI is now the default provider. OpenAI remains available as a retained adapter behind the same normalized request/stream contract.\n\n",
        "Configure Vertex with:\n\n",
        "```bash\nVERTEX_AI_PROJECT=your-gcp-project\nVERTEX_AI_LOCATION=us-central1\nVERTEX_AI_MODEL=gemini-2.5-flash\n```\n\n",
        "Then restart `pnpm dev:api` and ask again.",
      ];

      for (const chunk of chunks) {
        await delay(60);
        yield { type: "delta", content: chunk };
      }
    },
    async planMemoryMaintenance(request: MemoryMaintenanceRequest) {
      const match = request.question.match(/以后(都)?用(.+?)(回答|回复)/);
      if (!match?.[2]) return [];

      const preference = `- 用户偏好：以后用${match[2].trim()}回答。`;
      const existing = request.workMemory.trim();
      return [
        {
          name: "update_work_memory",
          arguments: {
            content: existing ? `${existing}\n${preference}` : preference,
          },
        },
      ];
    },
  };
}
