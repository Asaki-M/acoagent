import type { WorkflowStep } from "../types/index.js";
import { step } from "./helpers.js";

export function andAll(config: {
  id: string;
  name?: string;
  retries?: number;
  steps: WorkflowStep[];
}) {
  return step({
    id: config.id,
    name: config.name,
    retries: config.retries,
    type: "all",
    execute: async (context) => Promise.all(config.steps.map((child) => child.execute(context))),
  });
}
