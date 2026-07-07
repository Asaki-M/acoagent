import type { ToolSource } from "../../tools/types.js";
import type { MemoryScope } from "../store.js";

// 工作记忆最大长度，避免模型把大段内容塞进长期记忆。
export const MAX_WORK_MEMORY_CHARS = 3_000;

// 工作记忆工具统一使用的来源信息。
export function memorySource(): ToolSource {
  return {
    type: "internal_api",
    id: "memory",
    label: "Memory Store",
  };
}

// 从工具上下文归一化出记忆作用域，保证工具调用也能定位到同一会话。
export function normalizeMemoryScope(context: {
  projectName?: string;
  projectPath?: string;
  sessionId?: string;
}): MemoryScope {
  const projectName = context.projectName || "Local project";

  return {
    projectName,
    projectPath: context.projectPath || projectName,
    sessionId: context.sessionId || "default",
  };
}

// 清理工作记忆内容：去空行、裁剪空白，并限制最大长度。
export function sanitizeWorkMemory(content: string) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_WORK_MEMORY_CHARS);
}
