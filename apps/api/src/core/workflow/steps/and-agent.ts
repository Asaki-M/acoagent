import type { WorkflowExecuteFn } from "../types/index.js";
import { step } from "./helpers.js";

export function andAgent(config: {
  id: string;
  name?: string;
  retries?: number;
  task: string | WorkflowExecuteFn<string>;
  execute?: WorkflowExecuteFn;
}) {
  return step({
    id: config.id,
    name: config.name,
    retries: config.retries,
    type: "agent",
    execute: async (context) => {
      const task = typeof config.task === "string" ? config.task : await config.task(context);
      if (config.execute) {
        return config.execute({
          ...context,
          data: {
            ...(typeof context.data === "object" && context.data ? context.data : {}),
            task,
          },
        });
      }

      return {
        ...(typeof context.data === "object" && context.data ? context.data : {}),
        agentTask: task,
        agentOutput: `Mock agent completed: ${task}`,
      };
    },
  });
}
