import { z } from "zod";
import type { JsonObject, JsonValue, RegisteredTool, ToolExecute, ToolSource } from "./types.js";

type BaseToolInput = {
  name: string;
  description: string;
  parameters?: z.ZodType;
  outputSchema?: z.ZodType;
  tags?: readonly string[];
};

type ToolInput = BaseToolInput & {
  source: ToolSource;
  execute: ToolExecute;
};

type HttpToolInput = BaseToolInput & {
  sourceId: string;
  label?: string;
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
};

type McpToolInput = BaseToolInput & {
  serverId: string;
  serverLabel?: string;
  invoke: (toolName: string, args: JsonObject) => Promise<JsonValue>;
};

// 通用 JSON 值 schema，用于校验工具输入输出都能被安全序列化。
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

// 通用 JSON 对象 schema，用于工具参数。
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);

// 创建基础运行时工具对象。
export function createTool(input: ToolInput): RegisteredTool {
  return {
    type: "user-defined",
    name: input.name,
    description: input.description,
    parameters: input.parameters ?? z.object({}).strict(),
    outputSchema: input.outputSchema,
    source: input.source,
    tags: input.tags,
    execute: input.execute,
  };
}

// 创建内部 API 工具，统一标记 source.type 为 internal_api。
export function createInternalApiTool(input: ToolInput): RegisteredTool {
  return createTool({
    ...input,
    source: {
      ...input.source,
      type: "internal_api",
    },
  });
}

// 创建 HTTP 外部服务工具，把工具调用转成一次 fetch 请求。
export function createExternalServiceTool(input: HttpToolInput): RegisteredTool {
  return createTool({
    name: input.name,
    description: input.description,
    parameters: input.parameters ?? jsonObjectSchema,
    outputSchema: input.outputSchema ?? jsonValueSchema,
    source: {
      type: "external_service",
      id: input.sourceId,
      label: input.label,
      metadata: {
        method: input.method ?? "POST",
        url: input.url,
      },
    },
    tags: input.tags,
    async execute(args) {
      const method = input.method ?? "POST";
      const response = await fetch(input.url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...input.headers,
        },
        body: method === "GET" ? undefined : JSON.stringify(args),
      });

      if (!response.ok) {
        throw new Error(`External service tool "${input.name}" failed with ${response.status}.`);
      }

      return parseResponse(response);
    },
  });
}

// 创建 MCP 工具适配器，把平台工具调用委托给 MCP server。
export function createMcpTool(input: McpToolInput): RegisteredTool {
  return createTool({
    name: input.name,
    description: input.description,
    parameters: input.parameters ?? jsonObjectSchema,
    outputSchema: input.outputSchema ?? jsonValueSchema,
    source: {
      type: "mcp",
      id: input.serverId,
      label: input.serverLabel,
      metadata: {
        mcpToolName: input.name,
      },
    },
    tags: input.tags,
    execute(args) {
      return input.invoke(input.name, jsonObjectSchema.parse(args));
    },
  });
}

// 根据响应类型解析工具返回值，JSON 响应会继续做 schema 校验。
async function parseResponse(response: Response): Promise<JsonValue> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return jsonValueSchema.parse(await response.json());
  }

  return response.text();
}
