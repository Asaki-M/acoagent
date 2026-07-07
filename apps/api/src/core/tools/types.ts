import type { ZodType } from "zod";

// 工具系统内部只传递 JSON 可序列化数据。
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

// 工具来源类型，用于区分内部 API、外部服务、MCP 和内置路由工具。
export type ToolSourceType = "external_service" | "mcp" | "internal_api" | "builtin";

// 工具来源元信息，前端和调试信息会展示这些内容。
export type ToolSource = {
  type: ToolSourceType;
  id: string;
  label?: string;
  metadata?: JsonObject;
};

// 对外展示的工具定义，不包含实际 execute 函数。
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  source: ToolSource;
  tags?: readonly string[];
};

// 工具执行时附带的上下文，主要用于定位项目和记忆会话。
export type ToolContext = {
  projectName?: string;
  projectPath?: string;
  sessionId?: string;
};

// 工具执行函数签名。
export type ToolExecute = (args: unknown, context: ToolContext) => Promise<unknown> | unknown;

// 运行时注册的完整工具对象。
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

// 工具搜索结果，附带相似度分数。
export type ToolCandidate = ToolDefinition & {
  score: number;
};

// 工具调用结果，包含工具定义和执行输出。
export type ToolCallResult = {
  tool: ToolDefinition;
  result: JsonValue;
};
