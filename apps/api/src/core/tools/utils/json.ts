import type { JsonObject, JsonValue } from "../types.js";

export function normalizeJsonObject(value: unknown): JsonObject {
  if (!isJsonObject(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, JsonValue] => isJsonValue(entry[1]))
      .map(([key, entryValue]) => [key, entryValue]),
  );
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;

  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}
