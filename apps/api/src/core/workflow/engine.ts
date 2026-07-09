import type {
  WorkflowDefinition,
  WorkflowRunSnapshot,
  WorkflowStatus,
  WorkflowStep,
  WorkflowStepData,
  WorkflowStepEvent,
  WorkflowTokenUsage,
  WorkflowTraceEvent,
} from "./types/index.js";

const SUSPENDED = "WORKFLOW_SUSPENDED";
const ABORTED = "WORKFLOW_ABORTED";

export class WorkflowControlSignal extends Error {
  readonly status: "suspended" | "aborted";
  readonly data?: unknown;

  constructor(status: "suspended" | "aborted", reason?: string, data?: unknown) {
    super(reason || (status === "suspended" ? SUSPENDED : ABORTED));
    this.name = "WorkflowControlSignal";
    this.status = status;
    this.data = data;
  }
}

export function createWorkflow(config: WorkflowDefinition) {
  return config;
}

export function createWorkflowController() {
  const abortController = new AbortController();
  let status: "running" | "suspended" | "aborted" = "running";
  let reason: string | undefined;

  return {
    signal: abortController.signal,
    suspend(nextReason = "Suspended by user") {
      if (status !== "running") return;
      status = "suspended";
      reason = nextReason;
      abortController.abort({ status, reason });
    },
    abort(nextReason = "Aborted by user") {
      if (status !== "running") return;
      status = "aborted";
      reason = nextReason;
      abortController.abort({ status, reason });
    },
    getStatus: () => status,
    getReason: () => reason,
  };
}

export async function executeWorkflow(options: {
  workflow: WorkflowDefinition;
  input: unknown;
  runId: string;
  retryCount?: number;
  signal: AbortSignal;
  onUpdate?: (snapshot: WorkflowRunSnapshot) => void;
}) {
  const startedAt = new Date().toISOString();
  const events: WorkflowStepEvent[] = [];
  const traces: WorkflowTraceEvent[] = [];
  const stepData = new Map<string, WorkflowStepData>();
  const workflowState = new Map<string, unknown>();
  const usage: WorkflowTokenUsage = {};
  const snapshot = (status: WorkflowStatus, result?: unknown, error?: string): WorkflowRunSnapshot => ({
    runId: options.runId,
    workflowId: options.workflow.id,
    workflowName: options.workflow.name,
    status,
    input: options.input,
    result,
    error,
    retryCount: options.retryCount ?? 0,
    startedAt,
    endedAt: status === "running" ? undefined : new Date().toISOString(),
    events: [...events],
    traces: [...traces],
    usage: { ...usage },
  });

  const emit = () => options.onUpdate?.(snapshot("running"));

  try {
    let data = options.input;
    options.onUpdate?.(snapshot("running"));

    for (const step of options.workflow.steps) {
      data = await executeStep({
        step,
        data,
        input: options.input,
        signal: options.signal,
        path: step.id,
        events,
        traces,
        stepData,
        workflowState,
        usage,
        emit,
      });
    }

    const done = snapshot("succeeded", data);
    options.onUpdate?.(done);
    return done;
  } catch (error) {
    const control = toControlSignal(error, options.signal);
    if (control) {
      const next = snapshot(control.status, control.data, control.message);
      options.onUpdate?.(next);
      return next;
    }

    const next = snapshot("failed", undefined, error instanceof Error ? error.message : String(error));
    options.onUpdate?.(next);
    return next;
  }
}

async function executeStep(options: {
  step: WorkflowStep;
  data: unknown;
  input: unknown;
  signal: AbortSignal;
  path: string;
  events: WorkflowStepEvent[];
  traces: WorkflowTraceEvent[];
  stepData: Map<string, WorkflowStepData>;
  workflowState: Map<string, unknown>;
  usage: WorkflowTokenUsage;
  emit: () => void;
}): Promise<unknown> {
  throwIfStopped(options.signal);

  const maxAttempts = (options.step.retries ?? 0) + 1;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    const startedAt = Date.now();
    const event: WorkflowStepEvent = {
      id: options.step.id,
      path: options.path,
      type: options.step.type,
      name: options.step.name || options.step.id,
      status: "running",
      attempt,
      startedAt: new Date(startedAt).toISOString(),
      input: options.data,
    };

    options.events.push(event);
    options.stepData.set(options.step.id, { input: options.data, status: "running" });
    options.traces.push(
      makeWorkflowTrace(
        `workflow.step.${options.step.type}`,
        "running",
        `Started ${event.name} (${options.path}), attempt ${attempt}.`,
      ),
    );
    options.emit();

    const stepUsage: WorkflowTokenUsage = {};
    try {
      const output = await options.step.execute({
        input: options.input,
        data: options.data,
        attempt,
        signal: options.signal,
        workflowState: options.workflowState,
        getStepData: (stepId) => options.stepData.get(stepId),
        setWorkflowState: (key, value) => options.workflowState.set(key, value),
        reportUsage: (usage) => {
          addUsage(stepUsage, usage);
          addUsage(options.usage, usage);
        },
        suspend: (reason, data) => {
          throw new WorkflowControlSignal("suspended", reason || SUSPENDED, data);
        },
      });

      throwIfStopped(options.signal);
      finishEvent(event, "succeeded", startedAt, output, undefined, stepUsage);
      options.stepData.set(options.step.id, { input: options.data, output, status: "succeeded" });
      options.traces.push(
        makeWorkflowTrace(
          `workflow.step.${options.step.type}`,
          "done",
          usageDetail(`Completed ${event.name} (${options.path}) in ${event.durationMs}ms.`, stepUsage),
        ),
      );
      options.emit();
      return output;
    } catch (error) {
      const control = toControlSignal(error, options.signal);
      if (control) {
        finishEvent(event, control.status, startedAt, control.data, control.message);
        options.stepData.set(options.step.id, {
          input: options.data,
          output: control.data,
          status: control.status,
          error: control.message,
        });
        options.traces.push(
          makeWorkflowTrace(
            `workflow.step.${options.step.type}`,
            control.status === "suspended" ? "done" : "error",
            `${event.name} (${options.path}) was ${control.status}: ${control.message}.`,
          ),
        );
        options.emit();
        throw control;
      }

      const message = error instanceof Error ? error.message : String(error);
      finishEvent(event, "failed", startedAt, undefined, message, stepUsage);
      options.stepData.set(options.step.id, { input: options.data, status: "failed", error: message });
      options.traces.push(
        makeWorkflowTrace(
          `workflow.step.${options.step.type}`,
          "error",
          `Failed ${event.name} (${options.path}), attempt ${attempt}: ${message}.`,
        ),
      );
      options.emit();

      if (attempt >= maxAttempts) {
        throw error;
      }
    }
  }

  return options.data;
}

function finishEvent(
  event: WorkflowStepEvent,
  status: WorkflowStepEvent["status"],
  startedAt: number,
  output?: unknown,
  error?: string,
  usage?: WorkflowTokenUsage,
) {
  event.status = status;
  event.endedAt = new Date().toISOString();
  event.durationMs = Date.now() - startedAt;
  event.output = output;
  event.error = error;
  if (hasUsage(usage)) event.usage = { ...usage };
}

function throwIfStopped(signal: AbortSignal) {
  if (!signal.aborted) return;
  throw toControlSignal(undefined, signal);
}

function toControlSignal(error: unknown, signal: AbortSignal) {
  if (error instanceof WorkflowControlSignal) {
    return error;
  }

  if (!signal.aborted) return null;
  const reason = signal.reason as { status?: string; reason?: string } | undefined;
  if (reason?.status === "suspended") {
    return new WorkflowControlSignal("suspended", reason.reason || SUSPENDED);
  }
  return new WorkflowControlSignal("aborted", reason?.reason || ABORTED);
}

export function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(toControlSignal(undefined, signal));
      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(toControlSignal(undefined, signal));
      },
      { once: true },
    );
  });
}

function makeWorkflowTrace(
  name: string,
  status: WorkflowTraceEvent["status"],
  detail: string,
): WorkflowTraceEvent {
  return {
    id: `workflow-trace-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    status,
    detail,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

function addUsage(target: WorkflowTokenUsage, usage: WorkflowTokenUsage) {
  target.inputTokens = addOptional(target.inputTokens, usage.inputTokens);
  target.outputTokens = addOptional(target.outputTokens, usage.outputTokens);

  const reportedTotal = usage.totalTokens;
  const derivedTotal =
    usage.inputTokens !== undefined || usage.outputTokens !== undefined
      ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      : undefined;
  target.totalTokens = addOptional(target.totalTokens, reportedTotal ?? derivedTotal);
}

function addOptional(current: number | undefined, next: number | undefined) {
  if (next === undefined) return current;
  return (current ?? 0) + next;
}

function hasUsage(usage: WorkflowTokenUsage | undefined) {
  return (
    usage?.inputTokens !== undefined ||
    usage?.outputTokens !== undefined ||
    usage?.totalTokens !== undefined
  );
}

function usageDetail(detail: string, usage: WorkflowTokenUsage) {
  if (!hasUsage(usage)) return detail;

  return `${detail} Tokens input=${usage.inputTokens ?? "n/a"}, output=${
    usage.outputTokens ?? "n/a"
  }, total=${usage.totalTokens ?? "n/a"}.`;
}
