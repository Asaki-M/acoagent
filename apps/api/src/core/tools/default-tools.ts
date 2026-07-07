import type { MemoryStore } from "../memory/store.js";
import { createWorkMemoryRuntimeTools } from "../memory/tools.js";
import type { RegisteredTool } from "./types.js";

// 平台启动时默认注册的工具。目前只保留工作记忆工具。
export function createDefaultTools(memoryStore: MemoryStore): RegisteredTool[] {
  return createWorkMemoryRuntimeTools(memoryStore);
}
