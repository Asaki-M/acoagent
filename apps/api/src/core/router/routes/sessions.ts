import { makeTrace } from "../../transport/sse.js";
import type { ChatRequestBody } from "../../types/chat.js";
import { normalizeScope } from "../utils/scope.js";
import type { AppRouter, RouterDependencies } from "./types.js";

export function registerSessionRoutes(app: AppRouter, { memoryStore }: Pick<RouterDependencies, "memoryStore">) {
  app.get("/api/sessions", (context) => {
    const projectPath = context.req.query("projectPath");
    return context.json({
      sessions: memoryStore.listSessions(projectPath),
    });
  });

  app.post("/api/sessions", async (context) => {
    const body = (await context.req.json()) as Pick<ChatRequestBody, "projectName" | "projectPath" | "sessionId">;
    const scope = normalizeScope(body);

    memoryStore.ensureSession(scope);
    const trace = makeTrace("session.create", "done", "Created a new project-scoped memory session.");
    memoryStore.addTrace(scope, trace);

    return context.json({
      session: memoryStore.listSessions(scope.projectPath).find((session) => session.sessionId === scope.sessionId),
      trace,
    });
  });

  app.get("/api/history", (context) => {
    const projectName = context.req.query("projectName") || "Local project";
    const projectPath = context.req.query("projectPath") || projectName;
    const sessionId = context.req.query("sessionId") || "default";
    const scope = { projectName, projectPath, sessionId };

    memoryStore.ensureSession(scope);
    return context.json({
      messages: memoryStore.getMessages(scope),
      steps: memoryStore.getSteps(scope),
      traces: memoryStore.getTraces(scope),
      workMemory: memoryStore.getWorkMemory(scope),
    });
  });
}
