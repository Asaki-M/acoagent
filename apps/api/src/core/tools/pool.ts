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

export class ToolPool {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly embeddingCache = new Map<string, ToolEmbeddingCacheEntry>();

  constructor(private readonly embeddings: EmbeddingProvider = createEmbeddingProvider()) {}

  register(tool: RegisteredTool) {
    assertValidToolName(tool.name);
    this.tools.set(tool.name, tool);
    return toDefinition(tool);
  }

  registerMany(tools: RegisteredTool[]) {
    return tools.map((tool) => this.register(tool));
  }

  unregister(name: string) {
    this.embeddingCache.delete(name);
    return this.tools.delete(name);
  }

  listTools(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => toDefinition(tool));
  }

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

export async function runTool(
  tool: RegisteredTool,
  args: JsonObject = {},
  context: ToolContext = {},
): Promise<JsonValue> {
  const parsedInput = parseToolValue(tool.parameters, args, `Invalid arguments for tool "${tool.name}".`);
  const rawResult = await tool.execute(parsedInput, context);
  return parseToolValue(tool.outputSchema ?? jsonValueSchema, rawResult, `Invalid result from tool "${tool.name}".`);
}

export class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`Tool "${name}" was not found in the tool pool.`);
    this.name = "ToolNotFoundError";
  }
}

export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolValidationError";
  }
}

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

function toJsonObjectSchema(schema: z.ZodType): JsonObject {
  const jsonSchema = z.toJSONSchema(schema);
  return isJsonObject(jsonSchema) ? jsonSchema : {};
}

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

function normalizeTopK(topK: number) {
  if (!Number.isFinite(topK)) return DEFAULT_TOP_K;
  return Math.min(Math.max(Math.trunc(topK), 1), MAX_TOP_K);
}

function assertValidToolName(name: string) {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) {
    throw new ToolValidationError(
      "Tool names must start with a letter and contain only letters, numbers, underscores, or hyphens.",
    );
  }
}
