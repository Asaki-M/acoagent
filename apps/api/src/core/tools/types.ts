import type { ZodType } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type ToolSourceType = "external_service" | "mcp" | "internal_api" | "builtin";

export type ToolSource = {
  type: ToolSourceType;
  id: string;
  label?: string;
  metadata?: JsonObject;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  source: ToolSource;
  tags?: readonly string[];
};

export type ToolContext = {
  projectName?: string;
  projectPath?: string;
  sessionId?: string;
};

export type ToolExecute = (args: unknown, context: ToolContext) => Promise<unknown> | unknown;

export type RegisteredTool = {
  type: "user-defined";
  name: string;
  description: string;
  parameters: ZodType;
  outputSchema?: ZodType;
  source: ToolSource;
  tags?: readonly string[];
  execute: ToolExecute;
};

export type ToolCandidate = ToolDefinition & {
  score: number;
};

export type ToolCallResult = {
  tool: ToolDefinition;
  result: JsonValue;
};
