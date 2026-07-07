import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 解析 SQLite 数据库路径，优先使用 MEMORY_DB_PATH。
export function defaultDatabasePath() {
  return process.env.MEMORY_DB_PATH
    ? resolve(process.env.MEMORY_DB_PATH)
    : fileURLToPath(new URL("../../../../.data/memory.sqlite", import.meta.url));
}

// 将用户问题压缩成步骤标题，避免历史列表标题过长。
export function truncateTitle(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized || "Untitled step";
}
