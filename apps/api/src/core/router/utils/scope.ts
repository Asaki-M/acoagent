import type { ChatRequestBody } from "../../types/chat.js";

export function normalizeScope(body: Pick<ChatRequestBody, "projectName" | "projectPath" | "sessionId">) {
  const projectName = body.projectName || "Local project";
  return {
    projectName,
    projectPath: body.projectPath || projectName,
    sessionId: body.sessionId || "default",
  };
}
