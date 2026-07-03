import type { MemoryToolCall } from "../harness/types.js";
import type { MemoryScope, MemoryStore } from "./store.js";

const MAX_WORK_MEMORY_CHARS = 3_000;

export function buildMemorySystemInstruction(workMemory: string) {
  return [
    "Memory:",
    "- Short-term memory contains the latest 5 persisted conversation messages for this project session.",
    "- Work memory stores durable user preferences and stable project/session facts only.",
    "- Do not infer preferences from one-off requests unless the user clearly asks you to remember them.",
    "- Never store secrets, credentials, tokens, private keys, or raw large code snippets.",
    workMemory ? `Current work memory:\n${workMemory}` : "Current work memory: empty.",
  ].join("\n");
}

export function buildMemoryMaintenancePrompt(input: {
  question: string;
  answer: string;
  workMemory: string;
}) {
  return [
    "Decide whether work memory should change after this exchange.",
    "Use the available tools only when the user states a durable preference or stable project/session fact worth remembering.",
    "Good examples: preferred response language, coding style preference, package manager preference, project-specific convention.",
    "Bad examples: transient task details, ordinary code answers, secrets, credentials, or copied source code.",
    "",
    `Current work memory:\n${input.workMemory || "(empty)"}`,
    "",
    `User message:\n${input.question}`,
    "",
    `Assistant answer:\n${input.answer.slice(0, 4_000)}`,
  ].join("\n");
}

export function memoryToolDeclarations() {
  return [
    {
      name: "get_work_memory",
      description: "Read the current durable work memory for this project session.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "update_work_memory",
      description:
        "Replace work memory with a concise set of durable user preferences and stable project/session facts. Keep it short and do not include secrets or raw source code.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The complete new work memory content.",
          },
        },
        required: ["content"],
      },
    },
    {
      name: "clear_work_memory",
      description: "Clear work memory when the user explicitly asks to forget remembered preferences or facts.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  ] as const;
}

export function executeMemoryToolCalls(store: MemoryStore, scope: MemoryScope, calls: MemoryToolCall[]) {
  const applied: string[] = [];

  for (const call of calls) {
    if (call.name === "get_work_memory") {
      store.getWorkMemory(scope);
      applied.push(call.name);
      continue;
    }

    if (call.name === "clear_work_memory") {
      store.clearWorkMemory(scope);
      applied.push(call.name);
      continue;
    }

    if (call.name === "update_work_memory") {
      const rawContent = typeof call.arguments.content === "string" ? call.arguments.content : "";
      const content = sanitizeWorkMemory(rawContent);
      if (content) {
        store.updateWorkMemory(scope, content);
        applied.push(call.name);
      }
    }
  }

  return applied;
}

function sanitizeWorkMemory(content: string) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_WORK_MEMORY_CHARS);
}
