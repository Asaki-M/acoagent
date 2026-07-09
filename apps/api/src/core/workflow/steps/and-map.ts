import type { WorkflowMapEntry } from "../types/index.js";
import { resolveMapEntry, step } from "./helpers.js";

export function andMap(config: {
  id: string;
  name?: string;
  retries?: number;
  map: Record<string, WorkflowMapEntry>;
}) {
  return step({
    id: config.id,
    name: config.name,
    retries: config.retries,
    type: "map",
    execute: async (context) => {
      const result: Record<string, unknown> = {};

      for (const [key, entry] of Object.entries(config.map)) {
        result[key] = await resolveMapEntry(entry, context);
      }

      return result;
    },
  });
}
