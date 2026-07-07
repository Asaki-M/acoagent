import type { MemoryMaintenanceRequest, ModelProvider, ModelRequest, ModelStreamChunk } from "../../service/harness/types.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 创建本地 mock provider，在云模型未配置时提供可运行的演示响应。
export function createMockProvider(): ModelProvider {
  return {
    name: "mock",
    defaultModel: "mock-code-assistant",
    // mock 永远可用，作为真实 provider 不可用时的兜底。
    isConfigured() {
      return true;
    },
    // 输出固定的演示流，模拟模型分片返回。
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
    // 简单识别“以后用某语言回答”这类偏好，用于本地演示工作记忆写入。
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
