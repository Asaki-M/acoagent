import type { ChatRequestBody } from "../../types/chat.js";

// 从请求体归一化出记忆作用域，缺省时回退到本地项目/default 会话。
export function normalizeScope(body: Pick<ChatRequestBody, "projectName" | "projectPath" | "sessionId">) {
  const projectName = body.projectName || "Local project";
  return {
    projectName,
    projectPath: body.projectPath || projectName,
    sessionId: body.sessionId || "default",
  };
}
