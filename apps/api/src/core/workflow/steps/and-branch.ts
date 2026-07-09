import type { WorkflowConditionFn, WorkflowStep } from "../types/index.js";
import { step } from "./helpers.js";

export function andBranch(config: {
  id: string;
  name?: string;
  retries?: number;
  branches: Array<{
    name?: string;
    condition: WorkflowConditionFn;
    step: WorkflowStep;
  }>;
}) {
  return step({
    id: config.id,
    name: config.name,
    retries: config.retries,
    type: "branch",
    execute: async (context) => {
      const results: unknown[] = [];

      for (const branch of config.branches) {
        if (await branch.condition(context)) {
          results.push(await branch.step.execute(context));
        }
      }

      return {
        ...(typeof context.data === "object" && context.data ? context.data : {}),
        branches: results,
      };
    },
  });
}
