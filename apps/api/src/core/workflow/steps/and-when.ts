import type { WorkflowConditionFn, WorkflowStep } from "../types/index.js";
import { step } from "./helpers.js";

export function andWhen(config: {
  id: string;
  name?: string;
  retries?: number;
  condition: WorkflowConditionFn;
  step: WorkflowStep;
}) {
  return step({
    id: config.id,
    name: config.name,
    retries: config.retries,
    type: "when",
    execute: async (context) => {
      if (!(await config.condition(context))) {
        return context.data;
      }

      return config.step.execute(context);
    },
  });
}
