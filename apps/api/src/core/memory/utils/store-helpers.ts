import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function defaultDatabasePath() {
  return process.env.MEMORY_DB_PATH
    ? resolve(process.env.MEMORY_DB_PATH)
    : fileURLToPath(new URL("../../../../.data/memory.sqlite", import.meta.url));
}

export function truncateTitle(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized || "Untitled step";
}
