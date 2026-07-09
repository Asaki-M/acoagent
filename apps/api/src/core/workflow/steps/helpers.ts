import type { WorkflowExecuteContext, WorkflowMapEntry, WorkflowStep } from "../types/index.js";

export function step(config: Omit<WorkflowStep, "name"> & { name?: string }): WorkflowStep {
  return config;
}

export function readPath(value: unknown, path?: string) {
  if (!path || path === ".") return value;

  return path.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, value);
}

export async function resolveMapEntry(entry: WorkflowMapEntry, context: WorkflowExecuteContext) {
  if (entry.source === "value") return entry.value;
  if (entry.source === "data") return readPath(context.data, entry.path);
  if (entry.source === "input") return readPath(context.input, entry.path);
  if (entry.source === "fn") return entry.fn(context);

  const stepData = context.getStepData(entry.stepId);
  if (!stepData) return undefined;
  return readPath(stepData.output ?? stepData.input, entry.path);
}
