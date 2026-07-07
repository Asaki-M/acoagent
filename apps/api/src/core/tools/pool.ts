import { z } from "zod";
import { jsonValueSchema } from "./adapters.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "./embeddings.js";
import { isJsonObject, isJsonValue } from "./utils/json.js";
import type {
  JsonObject,
  JsonValue,
  RegisteredTool,
  ToolCallResult,
  ToolCandidate,
  ToolContext,
  ToolDefinition,
} from "./types.js";
import { buildToolIndexText, cosineSimilarity, type Vector } from "./utils/vector.js";

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;

type ToolEmbeddingCacheEntry = {
  text: string;
  vector: Vector;
};

// 工具池：负责注册工具、列出工具、向量检索工具，并统一执行工具调用。
export class ToolPool {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly embeddingCache = new Map<string, ToolEmbeddingCacheEntry>();

  constructor(private readonly embeddings: EmbeddingProvider = createEmbeddingProvider()) {}

  // 注册单个工具，并返回对外展示的工具定义。
  register(tool: RegisteredTool) {
    assertValidToolName(tool.name);
    this.tools.set(tool.name, tool);
    return toDefinition(tool);
  }

  // 批量注册工具。
  registerMany(tools: RegisteredTool[]) {
    return tools.map((tool) => this.register(tool));
  }

  // 移除工具，同时清理对应的向量缓存。
  unregister(name: string) {
    this.embeddingCache.delete(name);
    return this.tools.delete(name);
  }

  // 列出当前已注册工具的公开定义。
  listTools(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => toDefinition(tool));
  }

  // 使用 embedding 相似度搜索最相关的工具。
  async searchTools(query: string, topK = DEFAULT_TOP_K): Promise<ToolCandidate[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const queryVector = await this.embeddings.embed(normalizedQuery);
    await this.syncEmbeddingCache();
    const limit = normalizeTopK(topK);

    return [...this.tools.values()]
      .map((tool) => {
        const definition = toDefinition(tool);
        const cached = this.embeddingCache.get(tool.name);
        return {
          ...definition,
          score: cached ? cosineSimilarity(queryVector, cached.vector) : 0,
        };
      })
      .filter((tool) => tool.score > 0)
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
      .slice(0, limit);
  }

  // 按名称调用工具，并返回工具定义和执行结果。
  async callTool(name: string, args: JsonObject = {}, context: ToolContext = {}): Promise<ToolCallResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }

    const result = await runTool(tool, args, context);

    return {
      tool: toDefinition(tool),
      result,
    };
  }

  // 同步工具索引文本的 embedding 缓存，避免每次搜索都重复生成向量。
  private async syncEmbeddingCache() {
    for (const cachedName of this.embeddingCache.keys()) {
      if (!this.tools.has(cachedName)) {
        this.embeddingCache.delete(cachedName);
      }
    }

    for (const tool of this.tools.values()) {
      const text = buildToolIndexText(toDefinition(tool));
      const cached = this.embeddingCache.get(tool.name);
      if (cached?.text === text) continue;

      this.embeddingCache.set(tool.name, {
        text,
        vector: await this.embeddings.embed(text),
      });
    }
  }
}

// 执行单个工具：先校验入参，再校验输出，确保都是 JSON 可序列化数据。
export async function runTool(
  tool: RegisteredTool,
  args: JsonObject = {},
  context: ToolContext = {},
): Promise<JsonValue> {
  const parsedInput = parseToolValue(tool.parameters, args, `Invalid arguments for tool "${tool.name}".`);
  const rawResult = await tool.execute(parsedInput, context);
  return parseToolValue(tool.outputSchema ?? jsonValueSchema, rawResult, `Invalid result from tool "${tool.name}".`);
}

// 工具名不存在时抛出的错误，路由层会转换成 404。
export class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`Tool "${name}" was not found in the tool pool.`);
    this.name = "ToolNotFoundError";
  }
}

// 工具入参或返回值校验失败时抛出的错误，路由层会转换成 400。
export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolValidationError";
  }
}

// 将运行时工具对象转换成可暴露给前端/模型的定义。
function toDefinition(tool: RegisteredTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: toJsonObjectSchema(tool.parameters),
    outputSchema: toJsonObjectSchema(tool.outputSchema ?? jsonValueSchema),
    source: tool.source,
    tags: tool.tags,
  };
}

// 将 Zod schema 转成 JSON Schema，失败时回退为空对象。
function toJsonObjectSchema(schema: z.ZodType): JsonObject {
  const jsonSchema = z.toJSONSchema(schema);
  return isJsonObject(jsonSchema) ? jsonSchema : {};
}

// 校验工具输入或输出，同时保证结果符合 JsonValue 类型。
function parseToolValue(schema: z.ZodType, value: unknown, message: string): JsonValue {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ToolValidationError(`${message} ${z.prettifyError(parsed.error)}`);
  }

  if (!isJsonValue(parsed.data)) {
    throw new ToolValidationError(`${message} Parsed value is not JSON serializable.`);
  }

  return parsed.data;
}

// 约束工具搜索返回数量，防止请求过大。
function normalizeTopK(topK: number) {
  if (!Number.isFinite(topK)) return DEFAULT_TOP_K;
  return Math.min(Math.max(Math.trunc(topK), 1), MAX_TOP_K);
}

// 校验工具名满足主流 function calling 的命名限制。
function assertValidToolName(name: string) {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) {
    throw new ToolValidationError(
      "Tool names must start with a letter and contain only letters, numbers, underscores, or hyphens.",
    );
  }
}
