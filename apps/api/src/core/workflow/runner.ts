import { randomUUID } from "node:crypto";
import { createWorkflowController, delay, executeWorkflow, createWorkflow } from "./engine.js";
import { WorkflowStore, type PersistedWorkflow, type WorkflowNodeRecord } from "./store.js";
import { andAgent, andAll, andBranch, andMap, andTap, andThen, andWhen, andWhile } from "./steps/index.js";
import type { WorkflowDefinition, WorkflowRunSnapshot } from "./types/index.js";

type StoredRun = {
  workflowId: string;
  input: unknown;
  retryCount: number;
  controller: ReturnType<typeof createWorkflowController>;
  snapshot: WorkflowRunSnapshot;
};

const workflowStore = new WorkflowStore();
const runs = new Map<string, StoredRun>();

export function listWorkflows() {
  return workflowStore.listWorkflows();
}

export function createPersistedWorkflow(input: Parameters<WorkflowStore["createWorkflow"]>[0]) {
  return workflowStore.createWorkflow(input);
}

export function updatePersistedWorkflow(id: string, input: Parameters<WorkflowStore["updateWorkflow"]>[1]) {
  return workflowStore.updateWorkflow(id, input);
}

export function startWorkflowRun(workflowId: string, input: unknown) {
  return runWorkflow({ workflowId, input, retryCount: 0 });
}

export function getWorkflowRun(runId: string) {
  return runs.get(runId)?.snapshot;
}

export function suspendWorkflowRun(runId: string, reason?: string) {
  const run = mustGetRun(runId);
  run.controller.suspend(reason);
  return run.snapshot;
}

export function abortWorkflowRun(runId: string, reason?: string) {
  const run = mustGetRun(runId);
  run.controller.abort(reason);
  return run.snapshot;
}

export function retryWorkflowRun(runId: string) {
  const run = mustGetRun(runId);
  return runWorkflow({
    workflowId: run.workflowId,
    input: run.input,
    retryCount: run.retryCount + 1,
  });
}

function runWorkflow(options: { workflowId: string; input: unknown; retryCount: number }) {
  const persistedWorkflow = workflowStore.getWorkflow(options.workflowId);
  if (!persistedWorkflow) {
    throw new Error(`Workflow '${options.workflowId}' was not found.`);
  }

  const workflow = buildExecutableWorkflow(persistedWorkflow);
  const runId = randomUUID();
  const controller = createWorkflowController();
  const startedAt = new Date().toISOString();
  const initialSnapshot: WorkflowRunSnapshot = {
    runId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: "running",
    input: options.input,
    retryCount: options.retryCount,
    startedAt,
    events: [],
    traces: [],
    usage: {},
  };

  const stored: StoredRun = {
    workflowId: options.workflowId,
    input: options.input,
    retryCount: options.retryCount,
    controller,
    snapshot: initialSnapshot,
  };
  runs.set(runId, stored);

  void executeWorkflow({
    workflow,
    input: options.input,
    runId,
    retryCount: options.retryCount,
    signal: controller.signal,
    onUpdate: (snapshot) => {
      stored.snapshot = snapshot;
    },
  });

  return initialSnapshot;
}

function mustGetRun(runId: string) {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`Run '${runId}' was not found.`);
  }
  return run;
}

function buildExecutableWorkflow(workflow: PersistedWorkflow): WorkflowDefinition {
  const orderedNodes = orderNodes(workflow);

  return createWorkflow({
    id: workflow.id,
    name: workflow.name,
    steps: orderedNodes.map((node, index) => {
      const base = {
        id: node.id,
        name: node.data.title,
      };
      const kind = normalizeStepKind(node.data.kind);

      if (kind === "andAgent") {
        return andAgent({
          ...base,
          task: ({ data }) => `Run ${node.data.title} with ${JSON.stringify(data)}`,
          execute: async ({ data, reportUsage, signal }) => {
            await delay(450, signal);
            reportUsage(estimateAgentUsage(node.data.title, node.data.description, data));
            return {
              ...(typeof data === "object" && data ? data : {}),
              [node.id]: {
                kind: node.data.kind,
                title: node.data.title,
                output: node.data.description || "Agent step completed.",
              },
            };
          },
        });
      }

      if (kind === "andWhen") {
        return andWhen({
          ...base,
          condition: () => true,
          step: andThen({
            id: `${node.id}-matched`,
            name: `${node.data.title} matched`,
            execute: ({ data }) => data,
          }),
        });
      }

      if (kind === "andMap") {
        return andMap({
          ...base,
          map: {
            previous: { source: "data" },
            node: { source: "value", value: node.data.title },
            description: { source: "value", value: node.data.description },
          },
        });
      }

      if (kind === "andTap") {
        return andTap({
          ...base,
          execute: async ({ signal }) => {
            await delay(150, signal);
          },
        });
      }

      if (kind === "andAll") {
        return andAll({
          ...base,
          steps: [
            andThen({
              id: `${node.id}-parallel-a`,
              name: `${node.data.title} A`,
              execute: async ({ data, signal }) => {
                await delay(180, signal);
                return { branch: "a", data };
              },
            }),
            andThen({
              id: `${node.id}-parallel-b`,
              name: `${node.data.title} B`,
              execute: async ({ data, signal }) => {
                await delay(220, signal);
                return { branch: "b", data };
              },
            }),
          ],
        });
      }

      if (kind === "andWhile") {
        return andWhile({
          ...base,
          maxIterations: 1,
          condition: ({ data }) => !Boolean((data as Record<string, unknown>)[`${node.id}Done`]),
          steps: [
            andThen({
              id: `${node.id}-loop-body`,
              name: `${node.data.title} body`,
              execute: ({ data }) => ({
                ...(typeof data === "object" && data ? data : {}),
                [`${node.id}Done`]: true,
              }),
            }),
          ],
        });
      }

      if (kind === "andBranch") {
        return andBranch({
          ...base,
          branches: [
            {
              condition: () => true,
              step: andThen({
                id: `${node.id}-branch`,
                name: `${node.data.title} branch`,
                execute: ({ data }) => ({
                  ...(typeof data === "object" && data ? data : {}),
                  branch: node.data.title,
                }),
              }),
            },
          ],
        });
      }

      if (kind === "andThen" && index === 0) {
        return andThen({
          ...base,
          execute: async ({ data, signal }) => {
            await delay(250, signal);
            return {
              input: data,
              trigger: node.data.title,
            };
          },
        });
      }

      return andThen({
        ...base,
        execute: async ({ data, signal }) => {
          await delay(250, signal);
          return {
            ...(typeof data === "object" && data ? data : {}),
            [node.id]: node.data.description || node.data.title,
          };
        },
      });
    }),
  });
}

function normalizeStepKind(kind: string) {
  if (
    kind === "andThen" ||
    kind === "andAgent" ||
    kind === "andTap" ||
    kind === "andBranch" ||
    kind === "andWhen" ||
    kind === "andAll" ||
    kind === "andWhile" ||
    kind === "andMap"
  ) {
    return kind;
  }

  if (kind === "Agent") return "andAgent";
  if (kind === "Condition") return "andWhen";
  if (kind === "Transform" || kind === "Action") return "andMap";
  return "andThen";
}

function orderNodes(workflow: PersistedWorkflow) {
  if (workflow.nodes.length <= 1) return workflow.nodes;

  const targets = new Set(workflow.edges.map((edge) => edge.target));
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string>();
  for (const edge of workflow.edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, edge.target);
  }

  const start = workflow.nodes.find((node) => !targets.has(node.id)) ?? workflow.nodes[0];
  if (!start) return [];
  const ordered: WorkflowNodeRecord[] = [];
  const visited = new Set<string>();
  let current: WorkflowNodeRecord | undefined = start;

  while (current && !visited.has(current.id)) {
    ordered.push(current);
    visited.add(current.id);
    const nextId = outgoing.get(current.id);
    current = nextId ? byId.get(nextId) : undefined;
  }

  return [...ordered, ...workflow.nodes.filter((node) => !visited.has(node.id))];
}

function estimateAgentUsage(title: string, description: string, data: unknown) {
  const prompt = `Run ${title} with ${JSON.stringify(data)}\n${description}`;
  const output = description || "Agent step completed.";

  return {
    inputTokens: estimateTokens(prompt),
    outputTokens: estimateTokens(output),
  };
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}
