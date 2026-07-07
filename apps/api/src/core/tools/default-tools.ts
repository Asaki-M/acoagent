import { z } from "zod";
import type { MemoryStore } from "../memory/store.js";
import { createMemoryTools } from "../memory/tools.js";
import { createInternalApiTool, jsonValueSchema } from "./adapters.js";
import type { RegisteredTool } from "./types.js";

const emptyParameters = z.object({}).strict();
const platformHealthOutputSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  defaultProvider: z.string(),
});
const listSessionsParameters = z
  .object({
    projectPath: z.string().optional(),
  })
  .strict();
export function createDefaultTools(memoryStore: MemoryStore): RegisteredTool[] {
  return [
    createInternalApiTool({
      name: "platform_health",
      description: "Return API platform health and configured default model provider.",
      parameters: emptyParameters,
      outputSchema: platformHealthOutputSchema,
      source: {
        type: "internal_api",
        id: "platform",
        label: "AI Platform API",
      },
      tags: ["health", "status", "api"],
      execute() {
        return {
          ok: true,
          service: "ai-platform-api",
          defaultProvider: process.env.MODEL_PROVIDER || "vertex",
        };
      },
    }),
    createInternalApiTool({
      name: "list_memory_sessions",
      description: "List persisted memory sessions for the current project path.",
      parameters: listSessionsParameters,
      outputSchema: z.object({
        sessions: z.array(jsonValueSchema),
      }),
      source: {
        type: "internal_api",
        id: "memory",
        label: "Memory Store",
      },
      tags: ["memory", "sessions", "history"],
      execute(args, context) {
        const input = listSessionsParameters.parse(args);
        const projectPath = input.projectPath ?? context.projectPath;
        return {
          sessions: memoryStore.listSessions(projectPath),
        };
      },
    }),
    ...createMemoryTools(memoryStore),
  ];
}
