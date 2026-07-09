export type WorkflowTraceStatus = "queued" | "running" | "done" | "error";

export type WorkflowTraceEvent = {
  id: string;
  name: string;
  status: WorkflowTraceStatus;
  detail: string;
  time: string;
};

export type WorkflowTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};
