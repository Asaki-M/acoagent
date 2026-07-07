import type { JsonObject, JsonValue } from "../types.js";

// 将未知值收敛成 JSON 对象，并过滤掉不可序列化的字段。
export function normalizeJsonObject(value: unknown): JsonObject {
  if (!isJsonObject(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, JsonValue] => isJsonValue(entry[1]))
      .map(([key, entryValue]) => [key, entryValue]),
  );
}

// 判断一个值是否是 JSON 对象。
export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
}

// 判断一个值是否符合 JSON 可序列化值的定义。
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;

  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}
