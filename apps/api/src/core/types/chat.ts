export type CodeFile = {
  path: string;
  language: string;
  content: string;
};

export type ChatRequestBody = {
  projectName?: string;
  projectPath?: string;
  sessionId?: string;
  question?: string;
  files?: CodeFile[];
  provider?: string;
  model?: string;
};

export type TraceStatus = "queued" | "running" | "done" | "error";

export type TraceEvent = {
  id: string;
  name: string;
  status: TraceStatus;
  detail: string;
  time: string;
};
