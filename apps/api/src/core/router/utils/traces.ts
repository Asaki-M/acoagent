import type { MemoryStore } from "../../memory/store.js";
import { makeTrace, writeSse } from "../../transport/sse.js";
import type { TraceStatus } from "../../types/chat.js";
import type { normalizeScope } from "./scope.js";

export async function writeTraceSse(input: {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  encoder: InstanceType<typeof TextEncoder>;
  memoryStore: MemoryStore;
  scope: ReturnType<typeof normalizeScope>;
  name: string;
  status: TraceStatus;
  detail: string;
}) {
  const trace = makeTrace(input.name, input.status, input.detail);
  input.memoryStore.addTrace(input.scope, trace);
  await writeSse(input.writer, input.encoder, "trace", trace);
}
