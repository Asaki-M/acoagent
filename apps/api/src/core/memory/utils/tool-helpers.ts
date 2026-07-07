import type { ToolSource } from "../../tools/types.js";
import type { MemoryScope } from "../store.js";

export const MAX_WORK_MEMORY_CHARS = 3_000;

export function memorySource(): ToolSource {
  return {
    type: "internal_api",
    id: "memory",
    label: "Memory Store",
  };
}

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

export function sanitizeWorkMemory(content: string) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_WORK_MEMORY_CHARS);
}
