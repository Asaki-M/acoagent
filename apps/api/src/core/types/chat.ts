// 前端随问题提交的代码文件上下文。
export type CodeFile = {
  path: string;
  language: string;
  content: string;
};

// /api/chat 请求体，包含问题、项目作用域、模型选择和可选文件上下文。
export type ChatRequestBody = {
  projectName?: string;
  projectPath?: string;
  sessionId?: string;
  question?: string;
  files?: CodeFile[];
  provider?: string;
  model?: string;
};

// trace 的生命周期状态。
export type TraceStatus = "queued" | "running" | "done" | "error";

// 推送给前端并持久化的执行轨迹事件。
export type TraceEvent = {
  id: string;
  name: string;
  status: TraceStatus;
  detail: string;
  time: string;
};
