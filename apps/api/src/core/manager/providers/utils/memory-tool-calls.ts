import type { MemoryToolCall } from "../../../service/harness/types.js";
import { workMemoryToolSpecs } from "../../../memory/tools.js";

const memoryToolNames = new Set(workMemoryToolSpecs.map((tool) => tool.name));

// 过滤模型返回的工具调用，只允许已声明的工作记忆工具进入执行阶段。
export function isMemoryToolCall(
  call: { name?: string; arguments: Record<string, unknown> } | undefined,
): call is MemoryToolCall {
  if (!call?.name) return false;
  return memoryToolNames.has(call.name as MemoryToolCall["name"]);
}
