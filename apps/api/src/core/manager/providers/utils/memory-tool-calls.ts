import type { MemoryToolCall } from "../../../service/harness/types.js";
import { memoryToolSpecs } from "../../../memory/tools.js";

const memoryToolNames = new Set(memoryToolSpecs.map((tool) => tool.name));

export function isMemoryToolCall(
  call: { name?: string; arguments: Record<string, unknown> } | undefined,
): call is MemoryToolCall {
  if (!call?.name) return false;
  return memoryToolNames.has(call.name as MemoryToolCall["name"]);
}
