import type { WorkflowExecuteFn } from "../types/index.js";
import { step } from "./helpers.js";

export function andTap(config: {
  id: string;
  name?: string;
  retries?: number;
  execute: WorkflowExecuteFn;
}) {
  return step({
    id: config.id,
    name: config.name,
    retries: config.retries,
    type: "tap",
    execute: async (context) => {
      await config.execute(context);
      return context.data;
    },
  });
}
