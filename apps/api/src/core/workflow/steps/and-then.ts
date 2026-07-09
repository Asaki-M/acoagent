import type { WorkflowExecuteFn } from "../types/index.js";
import { step } from "./helpers.js";

export function andThen(config: {
  id: string;
  name?: string;
  retries?: number;
  execute: WorkflowExecuteFn;
}) {
  return step({ ...config, type: "then" });
}
