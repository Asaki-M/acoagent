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

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);

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

export function createInternalApiTool(input: ToolInput): RegisteredTool {
  return createTool({
    ...input,
    source: {
      ...input.source,
      type: "internal_api",
    },
  });
}

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

async function parseResponse(response: Response): Promise<JsonValue> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return jsonValueSchema.parse(await response.json());
  }

  return response.text();
}
