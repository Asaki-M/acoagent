import type { WorkflowConditionFn, WorkflowStep } from "../types/index.js";
import { step } from "./helpers.js";

export function andWhile(config: {
  id: string;
  name?: string;
  retries?: number;
  condition: WorkflowConditionFn;
  steps: WorkflowStep[];
  maxIterations?: number;
}) {
  return step({
    id: config.id,
    name: config.name,
    retries: config.retries,
    type: "while",
    execute: async (context) => {
      let data = context.data;
      let iteration = 0;
      const maxIterations = config.maxIterations ?? 10;

      while (await config.condition({ ...context, data })) {
        if (iteration >= maxIterations) {
          throw new Error(`andWhile '${config.id}' exceeded ${maxIterations} iterations.`);
        }

        for (const child of config.steps) {
          data = await child.execute({ ...context, data });
        }
        iteration += 1;
      }

      return data;
    },
  });
}
