import {
  abortWorkflowRun,
  createPersistedWorkflow,
  getWorkflowRun,
  listWorkflows,
  retryWorkflowRun,
  startWorkflowRun,
  suspendWorkflowRun,
  updatePersistedWorkflow,
} from "../../workflow/index.js";
import type { WorkflowInput } from "../../workflow/store.js";
import type { AppRouter } from "./types.js";

export function registerWorkflowRoutes(app: AppRouter) {
  app.get("/api/workflows", (context) => {
    return context.json({
      workflows: listWorkflows(),
    });
  });

  app.post("/api/workflows", async (context) => {
    const body = (await context.req.json()) as WorkflowInput;

    return context.json(createPersistedWorkflow(body), 201);
  });

  app.put("/api/workflows/:workflowId", async (context) => {
    const body = (await context.req.json()) as WorkflowInput;
    const workflow = updatePersistedWorkflow(context.req.param("workflowId"), body);

    if (!workflow) {
      return context.json({ message: "Workflow was not found." }, 404);
    }

    return context.json(workflow);
  });

  app.post("/api/workflows/run", async (context) => {
    const body = (await context.req.json()) as {
      workflowId?: string;
      input?: unknown;
    };

    try {
      return context.json(startWorkflowRun(body.workflowId || "article-summary", body.input ?? {}), 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start workflow.";
      return context.json({ message }, 404);
    }
  });

  app.get("/api/workflows/runs/:runId", (context) => {
    const snapshot = getWorkflowRun(context.req.param("runId"));
    if (!snapshot) {
      return context.json({ message: "Workflow run was not found." }, 404);
    }

    return context.json(snapshot);
  });

  app.post("/api/workflows/runs/:runId/suspend", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { reason?: string };

    try {
      return context.json(suspendWorkflowRun(context.req.param("runId"), body.reason));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not suspend workflow.";
      return context.json({ message }, 404);
    }
  });

  app.post("/api/workflows/runs/:runId/abort", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { reason?: string };

    try {
      return context.json(abortWorkflowRun(context.req.param("runId"), body.reason));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not abort workflow.";
      return context.json({ message }, 404);
    }
  });

  app.post("/api/workflows/runs/:runId/retry", (context) => {
    try {
      return context.json(retryWorkflowRun(context.req.param("runId")), 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not retry workflow.";
      return context.json({ message }, 404);
    }
  });
}
