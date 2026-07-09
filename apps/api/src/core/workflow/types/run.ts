import type { WorkflowStepStatus, WorkflowStepType } from "./step.js";
import type { WorkflowTokenUsage, WorkflowTraceEvent } from "./trace.js";

export type WorkflowStatus = "running" | "succeeded" | "failed" | "suspended" | "aborted";

export type WorkflowStepEvent = {
  id: string;
  path: string;
  type: WorkflowStepType;
  name: string;
  status: WorkflowStepStatus;
  attempt: number;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  usage?: WorkflowTokenUsage;
};

export type WorkflowRunSnapshot = {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: WorkflowStatus;
  input: unknown;
  result?: unknown;
  error?: string;
  retryCount: number;
  startedAt: string;
  endedAt?: string;
  events: WorkflowStepEvent[];
  traces: WorkflowTraceEvent[];
  usage: WorkflowTokenUsage;
};
