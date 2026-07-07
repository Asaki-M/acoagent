import type { TraceEvent, TraceStatus } from "../types/chat.js";

// 生成给前端展示用的当前时间字符串。
export function now() {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

// 将事件名和数据编码成 Server-Sent Events 文本格式。
export function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// 创建一条 trace 事件，附带唯一 id 和展示时间。
export function makeTrace(name: string, status: TraceStatus, detail: string): TraceEvent {
  return {
    id: `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    status,
    detail,
    time: now(),
  };
}

// 向 SSE stream 写入一条事件。
export async function writeSse(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: InstanceType<typeof TextEncoder>,
  event: string,
  data: unknown,
) {
  await writer.write(encoder.encode(encodeSse(event, data)));
}
