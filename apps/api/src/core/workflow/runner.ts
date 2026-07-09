import { randomUUID } from "node:crypto";
import { ModelHarness } from "../service/harness/model.js";
import type { ModelProviderName } from "../service/harness/types.js";
import { createWorkflowController, delay, executeWorkflow, createWorkflow } from "./engine.js";
import { WorkflowStore, type PersistedWorkflow, type WorkflowNodeRecord } from "./store.js";
import { andAgent, andAll, andBranch, andMap, andTap, andThen, andWhen, andWhile } from "./steps/index.js";
import type { WorkflowDefinition, WorkflowMapEntry, WorkflowRunSnapshot } from "./types/index.js";

type StoredRun = {
  workflowId: string;
  input: unknown;
  retryCount: number;
  controller: ReturnType<typeof createWorkflowController>;
  snapshot: WorkflowRunSnapshot;
};

type WorkflowNodeConfig = NonNullable<WorkflowNodeRecord["data"]["config"]>;
type MapEntryConfig = NonNullable<WorkflowNodeConfig["mapEntries"]>[number];
type ParallelStepConfig = NonNullable<WorkflowNodeConfig["parallelSteps"]>[number];
type BranchConfig = NonNullable<WorkflowNodeConfig["branches"]>[number];

const workflowStore = new WorkflowStore();
const runs = new Map<string, StoredRun>();
const modelHarness = ModelHarness.fromEnv();

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
      const config = node.data.config ?? {};

      if (kind === "andAgent") {
        return andAgent({
          ...base,
          task: ({ data }) => renderTemplate(config.task || `Run ${node.data.title} with {{data}}`, data),
          execute: async ({ data, reportUsage, signal }) => {
            const task = renderTemplate(config.task || node.data.description || node.data.title, data);
            const output = await runAgentStep({
              workflow,
              node,
              task,
              outputSchema: config.outputSchema,
              data,
              signal,
              reportUsage,
            });

            return {
              ...(typeof data === "object" && data ? data : {}),
              [node.id]: {
                kind: node.data.kind,
                title: node.data.title,
                task,
                schema: config.outputSchema,
                output,
              },
            };
          },
        });
      }

      if (kind === "andWhen") {
        return andWhen({
          ...base,
          condition: ({ data }) => evaluateCondition(config.condition, data),
          step: andThen({
            id: `${node.id}-matched`,
            name: `${node.data.title} matched`,
            execute: ({ data }) => ({
              ...(typeof data === "object" && data ? data : {}),
              [node.id]: {
                condition: config.condition,
                execute: config.executeLogic,
                matched: true,
              },
            }),
          }),
        });
      }

      if (kind === "andMap") {
        return andMap({
          ...base,
          map: parseMapConfig(config.mapEntries, config.mapJson, node.data.title, node.data.description),
        });
      }

      if (kind === "andTap") {
        return andTap({
          ...base,
          execute: async ({ signal }) => {
            await delay(150, signal);
            void config.sideEffect;
          },
        });
      }

      if (kind === "andAll") {
        const parallelSteps = parseNamedSteps(config.parallelSteps, config.parallelStepsJson, [
          { name: `${node.data.title} A`, execute: "return { branch: 'a', data }" },
          { name: `${node.data.title} B`, execute: "return { branch: 'b', data }" },
        ]);

        return andAll({
          ...base,
          steps: parallelSteps.map((stepConfig, stepIndex) =>
            andThen({
              id: `${node.id}-parallel-${stepIndex + 1}`,
              name: stepConfig.name,
              execute: async ({ data, signal }) => {
                await delay(180 + stepIndex * 40, signal);
                return { name: stepConfig.name, execute: stepConfig.execute, data };
              },
            }),
          ),
        });
      }

      if (kind === "andWhile") {
        return andWhile({
          ...base,
          maxIterations: clampIterations(config.maxIterations),
          condition: ({ data }) =>
            evaluateCondition(config.condition, data) &&
            !Boolean((data as Record<string, unknown>)[`${node.id}Done`]),
          steps: [
            andThen({
              id: `${node.id}-loop-body`,
              name: `${node.data.title} body`,
              execute: ({ data }) => ({
                ...(typeof data === "object" && data ? data : {}),
                [`${node.id}Done`]: true,
                [`${node.id}LoopBody`]: config.loopBody,
              }),
            }),
          ],
        });
      }

      if (kind === "andBranch") {
        const branches = parseBranchConfig(config.branches, config.branchesJson, node.data.title);

        return andBranch({
          ...base,
          branches: branches.map((branch, branchIndex) => ({
              condition: ({ data }) => evaluateCondition(branch.condition, data),
              step: andThen({
                id: `${node.id}-branch-${branchIndex + 1}`,
                name: branch.name,
                execute: ({ data }) => ({
                  ...(typeof data === "object" && data ? data : {}),
                  branch: branch.name,
                  branchExecute: branch.step,
                }),
              }),
            })),
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
              execute: config.executeLogic,
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
            [node.id]: {
              execute: config.executeLogic,
              output: node.data.description || node.data.title,
            },
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

async function runAgentStep(options: {
  workflow: PersistedWorkflow;
  node: WorkflowNodeRecord;
  task: string;
  outputSchema?: string;
  data: unknown;
  signal: AbortSignal;
  reportUsage: (usage: { inputTokens?: number; outputTokens?: number }) => void;
}) {
  let output = "";
  const question = [
    options.task,
    "",
    "Current workflow data:",
    JSON.stringify(options.data, null, 2),
    options.outputSchema ? `\nReturn output matching this schema hint:\n${options.outputSchema}` : "",
  ].join("\n");

  for await (const event of modelHarness.stream({
    provider: resolveWorkflowModelProvider(),
    model: process.env.WORKFLOW_MODEL || "",
    projectName: "Workflow Builder",
    projectPath: "workflow",
    sessionId: options.workflow.id,
    question,
    files: [],
    messages: [
      {
        role: "system",
        content:
          "You are executing a single workflow agent step. Return only the useful step output for downstream workflow data.",
      },
      {
        role: "user",
        content: question,
      },
    ],
    temperature: 0.2,
    maxOutputTokens: 800,
  })) {
    if (options.signal.aborted) {
      throw options.signal.reason instanceof Error ? options.signal.reason : new Error("Workflow agent step aborted.");
    }

    if (event.type === "delta") {
      output += event.content;
    }

    if (event.type === "usage") {
      options.reportUsage({
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      });
    }
  }

  return output.trim() || "Agent returned no output.";
}

function resolveWorkflowModelProvider(): ModelProviderName {
  const provider = process.env.WORKFLOW_MODEL_PROVIDER || process.env.MODEL_PROVIDER;
  if (provider === "openai" || provider === "vertex" || provider === "mock") return provider;
  return "vertex";
}

function renderTemplate(template: string, data: unknown) {
  return template.replaceAll("{{data}}", JSON.stringify(data));
}

function evaluateCondition(condition: string | undefined, data: unknown) {
  const normalized = condition?.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "false" || normalized.includes("=== false")) return false;
  if (normalized.includes("requireapproval")) {
    return Boolean((data as Record<string, unknown> | undefined)?.requireApproval);
  }
  if (normalized.includes("approved")) {
    return Boolean((data as Record<string, unknown> | undefined)?.approved);
  }
  return true;
}

function parseMapConfig(
  entries: MapEntryConfig[] | undefined,
  value: string | undefined,
  title: string,
  description: string,
): Record<string, WorkflowMapEntry> {
  const fallback: Record<string, WorkflowMapEntry> = {
    previous: { source: "data" },
    node: { source: "value", value: title },
    description: { source: "value", value: description },
  };

  if (Array.isArray(entries) && entries.length > 0) {
    return entries.reduce<Record<string, WorkflowMapEntry>>((map, entry) => {
      if (!entry.key.trim()) return map;

      if (entry.source === "value") {
        map[entry.key] = { source: "value", value: entry.value };
        return map;
      }

      if (entry.source === "step") {
        map[entry.key] = { source: "step", stepId: entry.stepId, path: entry.path || undefined };
        return map;
      }

      map[entry.key] = { source: entry.source, path: entry.path || undefined };
      return map;
    }, {});
  }

  if (!value?.trim()) return fallback;

  try {
    const parsed = JSON.parse(value) as Record<string, WorkflowMapEntry>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseNamedSteps(
  steps: ParallelStepConfig[] | undefined,
  value: string | undefined,
  fallback: Array<{ name: string; execute: string }>,
) {
  if (Array.isArray(steps) && steps.length > 0) {
    return steps.map((step, index) => ({
      name: step.name.trim() || `Parallel ${index + 1}`,
      execute: step.execute,
    }));
  }

  if (!value?.trim()) return fallback;

  try {
    const parsed = JSON.parse(value) as Array<{ name?: unknown; execute?: unknown }>;
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;
    return parsed.map((step, index) => ({
      name: typeof step.name === "string" && step.name.trim() ? step.name : `Parallel ${index + 1}`,
      execute: typeof step.execute === "string" ? step.execute : "",
    }));
  } catch {
    return fallback;
  }
}

function parseBranchConfig(
  branches: BranchConfig[] | undefined,
  value: string | undefined,
  fallbackName: string,
) {
  if (Array.isArray(branches) && branches.length > 0) {
    return branches.map((branch, index) => ({
      name: branch.name.trim() || `Branch ${index + 1}`,
      condition: branch.condition || "true",
      step: branch.step || "return data",
    }));
  }

  if (!value?.trim()) {
    return [{ name: `${fallbackName} branch`, condition: "true", step: "return data" }];
  }

  try {
    const parsed = JSON.parse(value) as Array<{ name?: unknown; condition?: unknown; step?: unknown }>;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [{ name: `${fallbackName} branch`, condition: "true", step: "return data" }];
    }
    return parsed.map((branch, index) => ({
      name: typeof branch.name === "string" && branch.name.trim() ? branch.name : `Branch ${index + 1}`,
      condition: typeof branch.condition === "string" ? branch.condition : "true",
      step: typeof branch.step === "string" ? branch.step : "",
    }));
  } catch {
    return [{ name: `${fallbackName} branch`, condition: "true", step: "return data" }];
  }
}

function clampIterations(value: number | undefined) {
  if (!Number.isFinite(value)) return 3;
  return Math.min(Math.max(Math.floor(value as number), 1), 20);
}
