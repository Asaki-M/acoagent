import type { WorkflowTokenUsage } from "./trace.js";

export type WorkflowJson = null | boolean | number | string | WorkflowJson[] | { [key: string]: WorkflowJson };

export type WorkflowStepStatus = "running" | "succeeded" | "failed" | "skipped" | "suspended" | "aborted";

export type WorkflowStepType =
  | "then"
  | "agent"
  | "tap"
  | "branch"
  | "when"
  | "all"
  | "while"
  | "map";

export type WorkflowStepData = {
  input: unknown;
  output?: unknown;
  status: WorkflowStepStatus;
  error?: string;
};

export type WorkflowMapEntry =
  | { source: "value"; value: unknown }
  | { source: "data"; path?: string }
  | { source: "input"; path?: string }
  | { source: "step"; stepId: string; path?: string }
  | { source: "fn"; fn: WorkflowExecuteFn };

export type WorkflowExecuteContext = {
  input: unknown;
  data: unknown;
  attempt: number;
  signal: AbortSignal;
  workflowState: Map<string, unknown>;
  getStepData: (stepId: string) => WorkflowStepData | undefined;
  setWorkflowState: (key: string, value: unknown) => void;
  reportUsage: (usage: WorkflowTokenUsage) => void;
  suspend: (reason?: string, data?: unknown) => never;
};

export type WorkflowExecuteFn<RESULT = unknown> = (
  context: WorkflowExecuteContext,
) => RESULT | Promise<RESULT>;

export type WorkflowConditionFn = (context: WorkflowExecuteContext) => boolean | Promise<boolean>;

export type WorkflowStep = {
  id: string;
  name?: string;
  type: WorkflowStepType;
  retries?: number;
  execute: WorkflowExecuteFn;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  steps: WorkflowStep[];
};
