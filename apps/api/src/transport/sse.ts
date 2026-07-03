import type { TraceEvent, TraceStatus } from "../types/chat.js";

export function now() {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

export function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function makeTrace(name: string, status: TraceStatus, detail: string): TraceEvent {
  return {
    id: `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    status,
    detail,
    time: now(),
  };
}

export async function writeSse(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: InstanceType<typeof TextEncoder>,
  event: string,
  data: unknown,
) {
  await writer.write(encoder.encode(encodeSse(event, data)));
}
