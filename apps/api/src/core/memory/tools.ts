import { z } from "zod";
import { createInternalApiTool } from "../tools/adapters.js";
import { normalizeJsonObject } from "../tools/utils/json.js";
import { runTool } from "../tools/pool.js";
import type { RegisteredTool } from "../tools/types.js";
import type { MemoryScope, MemoryStore } from "./store.js";
import {
  MAX_WORK_MEMORY_CHARS,
  memorySource,
  normalizeMemoryScope,
  sanitizeWorkMemory,
} from "./utils/tool-helpers.js";

const emptyParameters = z.object({}).strict();
const workMemoryOutputSchema = z.object({
  workMemory: z.string(),
});
const updateWorkMemoryParameters = z
  .object({
    content: z.string().max(MAX_WORK_MEMORY_CHARS),
  })
  .strict();
const toolStatusOutputSchema = z.object({
  ok: z.boolean(),
});

export const memoryToolSpecs = [
  {
    name: "get_work_memory",
    description: "Read durable work memory for the current project and session.",
    parameters: emptyParameters,
    outputSchema: workMemoryOutputSchema,
    tags: ["memory", "work-memory", "preferences"],
  },
  {
    name: "update_work_memory",
    description:
      "Replace durable work memory for the current project and session with concise stable preferences or facts.",
    parameters: updateWorkMemoryParameters,
    outputSchema: toolStatusOutputSchema,
    tags: ["memory", "work-memory", "preferences"],
  },
  {
    name: "clear_work_memory",
    description: "Clear durable work memory for the current project and session.",
    parameters: emptyParameters,
    outputSchema: toolStatusOutputSchema,
    tags: ["memory", "work-memory", "forget"],
  },
] as const;

export type MemoryToolName = (typeof memoryToolSpecs)[number]["name"];
export type MemoryToolCallInput = {
  name: MemoryToolName;
  arguments: Record<string, unknown>;
};

export function createMemoryTools(memoryStore: MemoryStore): RegisteredTool[] {
  return [
    createInternalApiTool({
      ...memoryToolSpecs[0],
      source: memorySource(),
      execute(_args, context) {
        return {
          workMemory: memoryStore.getWorkMemory(normalizeMemoryScope(context)),
        };
      },
    }),
    createInternalApiTool({
      ...memoryToolSpecs[1],
      source: memorySource(),
      execute(args, context) {
        const input = updateWorkMemoryParameters.parse(args);
        memoryStore.updateWorkMemory(normalizeMemoryScope(context), sanitizeWorkMemory(input.content));
        return { ok: true };
      },
    }),
    createInternalApiTool({
      ...memoryToolSpecs[2],
      source: memorySource(),
      execute(_args, context) {
        memoryStore.clearWorkMemory(normalizeMemoryScope(context));
        return { ok: true };
      },
    }),
  ];
}

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
  return memoryToolSpecs.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.parameters),
  }));
}

export async function executeMemoryToolCalls(store: MemoryStore, scope: MemoryScope, calls: MemoryToolCallInput[]) {
  const applied: string[] = [];
  const tools = new Map(createMemoryTools(store).map((tool) => [tool.name, tool]));

  for (const call of calls) {
    const tool = tools.get(call.name);
    if (tool) {
      await runTool(tool, normalizeJsonObject(call.arguments), scope);
      applied.push(call.name);
    }
  }

  return applied;
}
