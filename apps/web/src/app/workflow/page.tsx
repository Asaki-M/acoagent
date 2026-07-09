"use client";

import "@xyflow/react/dist/style.css";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  Handle,
  MarkerType,
  Node,
  NodeChange,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import {
  Bot,
  Check,
  ChevronDown,
  CircleDotDashed,
  GitBranch,
  GitFork,
  ListFilter,
  Map as MapIcon,
  MoreHorizontal,
  OctagonX,
  PanelRight,
  PauseCircle,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Trash2,
  Waypoints,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

type BuilderNodeData = {
  title: string;
  kind: NodeKind;
  description: string;
  accent: "green" | "violet" | "blue";
  config: StepConfig;
  runStatus?: string;
  runDurationMs?: number;
};

type BuilderNode = Node<BuilderNodeData, "builderNode">;

type NodeKind =
  | "andThen"
  | "andAgent"
  | "andTap"
  | "andBranch"
  | "andWhen"
  | "andAll"
  | "andWhile"
  | "andMap";

const nodeKinds = [
  "andThen",
  "andAgent",
  "andTap",
  "andBranch",
  "andWhen",
  "andAll",
  "andWhile",
  "andMap",
] satisfies NodeKind[];

type StepConfig = {
  executeLogic?: string;
  condition?: string;
  task?: string;
  outputSchema?: string;
  mapEntries?: MapEntryConfig[];
  mapJson?: string;
  sideEffect?: string;
  branches?: BranchConfig[];
  branchesJson?: string;
  parallelSteps?: ParallelStepConfig[];
  parallelStepsJson?: string;
  maxIterations?: number;
  loopBody?: string;
};

type BranchConfig = {
  id: string;
  name: string;
  condition: string;
  step: string;
};

type ParallelStepConfig = {
  id: string;
  name: string;
  execute: string;
};

type MapEntryConfig = {
  id: string;
  key: string;
  source: "data" | "input" | "step" | "value";
  path: string;
  value: string;
  stepId: string;
};

type WorkflowDraft = {
  id: string;
  name: string;
  nodes: BuilderNode[];
  edges: Edge[];
  nextNodeIndex: number;
  createdAt?: string;
  updatedAt?: string;
};

type WorkflowRunSnapshot = {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: "running" | "succeeded" | "failed" | "suspended" | "aborted";
  result?: unknown;
  error?: string;
  retryCount: number;
  startedAt: string;
  endedAt?: string;
  events: Array<{
    id: string;
    path: string;
    type: string;
    name: string;
    status: string;
    attempt: number;
    durationMs?: number;
    output?: unknown;
    error?: string;
    usage?: WorkflowTokenUsage;
  }>;
  traces: Array<{
    id: string;
    name: string;
    status: "queued" | "running" | "done" | "error";
    detail: string;
    time: string;
  }>;
  usage: WorkflowTokenUsage;
};

type WorkflowTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8787";

const nodeTemplates = [
  {
    kind: "andThen" as const,
    title: "Function Step",
    detail: "Run a normal async function",
    description: "Execute custom workflow logic",
    icon: Zap,
  },
  {
    kind: "andAgent" as const,
    title: "Agent Step",
    detail: "Prompt, model, tools",
    description: "Run an agent task",
    icon: Bot,
  },
  {
    kind: "andTap" as const,
    title: "Tap Step",
    detail: "Side effect without changing data",
    description: "Inspect or record data and pass it through",
    icon: CircleDotDashed,
  },
  {
    kind: "andBranch" as const,
    title: "Branch Step",
    detail: "Run matching branches",
    description: "Evaluate branches and run matched nested steps",
    icon: GitFork,
  },
  {
    kind: "andWhen" as const,
    title: "When Step",
    detail: "Run one nested step conditionally",
    description: "Execute a nested step when a condition passes",
    icon: GitBranch,
  },
  {
    kind: "andAll" as const,
    title: "All Step",
    detail: "Run nested steps in parallel",
    description: "Execute child steps and wait for all results",
    icon: Waypoints,
  },
  {
    kind: "andWhile" as const,
    title: "While Step",
    detail: "Loop nested steps",
    description: "Repeat child steps while a condition is true",
    icon: RotateCcw,
  },
  {
    kind: "andMap" as const,
    title: "Map Data",
    detail: "Map or format data",
    description: "Transform workflow data",
    icon: MapIcon,
  },
];

const defaultStepConfigs: Record<NodeKind, StepConfig> = {
  andThen: {
    executeLogic: "async ({ data }) => ({ ...data, processed: true })",
  },
  andAgent: {
    task: "Analyze the current workflow data and return a structured result.",
    outputSchema: '{ "result": "string", "confidence": "number" }',
  },
  andTap: {
    sideEffect: "console.log('workflow data', data)",
  },
  andBranch: {
    branches: [
      {
        id: "branch-approved",
        name: "approved",
        condition: "data.approved === true",
        step: 'return { ...data, route: "approved" }',
      },
    ],
  },
  andWhen: {
    condition: "data.requireApproval === true",
    executeLogic: "async ({ data }) => ({ ...data, approved: true })",
  },
  andAll: {
    parallelSteps: [
      { id: "parallel-profile", name: "fetch-profile", execute: "return { profile: data.userId }" },
      { id: "parallel-permissions", name: "fetch-permissions", execute: "return { permissions: [] }" },
    ],
  },
  andWhile: {
    condition: "data.count < 3",
    maxIterations: 3,
    loopBody: "async ({ data }) => ({ ...data, count: (data.count ?? 0) + 1 })",
  },
  andMap: {
    mapEntries: [
      { id: "map-previous", key: "previous", source: "data", path: ".", value: "", stepId: "" },
      { id: "map-title", key: "title", source: "input", path: "title", value: "", stepId: "" },
      { id: "map-summary", key: "summary", source: "value", path: "", value: "Mapped result", stepId: "" },
    ],
  },
};

function kindToAccent(kind: NodeKind): BuilderNodeData["accent"] {
  if (kind === "andAgent" || kind === "andWhen" || kind === "andBranch") return "violet";
  if (kind === "andMap" || kind === "andAll") return "blue";
  return "green";
}

function normalizeNodeKind(kind: string): NodeKind {
  if ((nodeKinds as readonly string[]).includes(kind)) return kind as NodeKind;
  if (kind === "Agent") return "andAgent";
  if (kind === "Condition") return "andWhen";
  if (kind === "Transform" || kind === "Action") return "andMap";
  return "andThen";
}

function normalizeWorkflow(workflow: WorkflowDraft): WorkflowDraft {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      const kind = normalizeNodeKind(String(node.data.kind));
      return {
        ...node,
        data: {
          ...node.data,
          kind,
          accent: kindToAccent(kind),
          config: normalizeStepConfig(kind, node.data.config),
        },
      };
    }),
  };
}

function normalizeStepConfig(kind: NodeKind, config?: StepConfig): StepConfig {
  const base = defaultStepConfigs[kind];
  const next = { ...base, ...(config ?? {}) };

  if (kind === "andBranch") {
    return {
      ...next,
      branches: normalizeBranches(next.branches, next.branchesJson),
    };
  }

  if (kind === "andAll") {
    return {
      ...next,
      parallelSteps: normalizeParallelSteps(next.parallelSteps, next.parallelStepsJson),
    };
  }

  if (kind === "andMap") {
    return {
      ...next,
      mapEntries: normalizeMapEntries(next.mapEntries, next.mapJson),
    };
  }

  return next;
}

function normalizeBranches(branches?: BranchConfig[], branchesJson?: string) {
  if (branches?.length) return branches;
  if (!branchesJson?.trim()) return defaultStepConfigs.andBranch.branches ?? [];

  try {
    const parsed = JSON.parse(branchesJson) as Array<Partial<BranchConfig>>;
    if (!Array.isArray(parsed)) return defaultStepConfigs.andBranch.branches ?? [];
    return parsed.map((branch, index) => ({
      id: branch.id || createConfigId("branch"),
      name: branch.name || `Branch ${index + 1}`,
      condition: branch.condition || "true",
      step: branch.step || "return data",
    }));
  } catch {
    return defaultStepConfigs.andBranch.branches ?? [];
  }
}

function normalizeParallelSteps(steps?: ParallelStepConfig[], stepsJson?: string) {
  if (steps?.length) return steps;
  if (!stepsJson?.trim()) return defaultStepConfigs.andAll.parallelSteps ?? [];

  try {
    const parsed = JSON.parse(stepsJson) as Array<Partial<ParallelStepConfig>>;
    if (!Array.isArray(parsed)) return defaultStepConfigs.andAll.parallelSteps ?? [];
    return parsed.map((step, index) => ({
      id: step.id || createConfigId("parallel"),
      name: step.name || `Parallel ${index + 1}`,
      execute: step.execute || "return data",
    }));
  } catch {
    return defaultStepConfigs.andAll.parallelSteps ?? [];
  }
}

function normalizeMapEntries(entries?: MapEntryConfig[], mapJson?: string) {
  if (entries?.length) return entries;
  if (!mapJson?.trim()) return defaultStepConfigs.andMap.mapEntries ?? [];

  try {
    const parsed = JSON.parse(mapJson) as Record<string, { source?: string; path?: string; value?: unknown; stepId?: string }>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultStepConfigs.andMap.mapEntries ?? [];
    return Object.entries(parsed).map(([key, entry]) => ({
      id: createConfigId("map"),
      key,
      source: isMapSource(entry.source) ? entry.source : "value",
      path: entry.path ?? "",
      value: entry.value === undefined ? "" : String(entry.value),
      stepId: entry.stepId ?? "",
    }));
  } catch {
    return defaultStepConfigs.andMap.mapEntries ?? [];
  }
}

function isMapSource(value: unknown): value is MapEntryConfig["source"] {
  return value === "data" || value === "input" || value === "step" || value === "value";
}

function createConfigId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createWorkflowName(index: number) {
  return `Workflow ${index}`;
}

function createWorkflowId() {
  return `workflow-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function BuilderCard({ data, selected }: NodeProps<BuilderNode>) {
  const accent = {
    green: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    violet: "border-violet-400/40 bg-violet-400/10 text-violet-300",
    blue: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  }[data.accent];
  const statusClass = data.runStatus ? stepStatusClass(data.runStatus) : "bg-[#222529] text-zinc-500";

  return (
    <div
      className={`w-[280px] rounded-lg border bg-[#17191b] shadow-xl shadow-black/20 transition ${
        selected ? "border-emerald-400 ring-2 ring-emerald-400/20" : "border-[#2a2e33]"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-zinc-500 !bg-[#111]" />
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-bold ${accent}`}>{data.kind}</span>
            {data.runStatus && (
              <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-bold ${statusClass}`}>
                {data.runStatus}
              </span>
            )}
          </div>
          <div className="truncate text-sm font-semibold text-zinc-100">{data.title}</div>
          <div className="mt-1 truncate text-xs text-zinc-500">
            {data.runDurationMs !== undefined ? `${data.runDurationMs}ms` : data.description}
          </div>
        </div>
        <button className="nodrag grid h-7 w-7 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-[#222529] hover:text-zinc-200">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-zinc-500 !bg-[#111]" />
    </div>
  );
}

const nodeTypes = { builderNode: BuilderCard };

function StepConfigFields({
  kind,
  config,
  onChange,
}: {
  kind: NodeKind;
  config: StepConfig;
  onChange: (update: Partial<StepConfig>) => void;
}) {
  if (kind === "andThen") {
    return (
      <ConfigSection title="Execute">
        <ConfigTextarea
          value={config.executeLogic ?? ""}
          onChange={(value) => onChange({ executeLogic: value })}
          minHeight="min-h-40"
        />
      </ConfigSection>
    );
  }

  if (kind === "andAgent") {
    return (
      <>
        <ConfigSection title="Task">
          <ConfigTextarea
            value={config.task ?? ""}
            onChange={(value) => onChange({ task: value })}
            minHeight="min-h-32"
          />
        </ConfigSection>
        <ConfigSection title="Output Schema">
          <ConfigTextarea
            value={config.outputSchema ?? ""}
            onChange={(value) => onChange({ outputSchema: value })}
            minHeight="min-h-32"
          />
        </ConfigSection>
      </>
    );
  }

  if (kind === "andTap") {
    return (
      <ConfigSection title="Side Effect">
        <ConfigTextarea
          value={config.sideEffect ?? ""}
          onChange={(value) => onChange({ sideEffect: value })}
          minHeight="min-h-36"
        />
      </ConfigSection>
    );
  }

  if (kind === "andWhen") {
    return (
      <>
        <ConfigSection title="Condition">
          <ConfigInput
            value={config.condition ?? ""}
            onChange={(value) => onChange({ condition: value })}
          />
        </ConfigSection>
        <ConfigSection title="Matched Step">
          <ConfigTextarea
            value={config.executeLogic ?? ""}
            onChange={(value) => onChange({ executeLogic: value })}
            minHeight="min-h-32"
          />
        </ConfigSection>
      </>
    );
  }

  if (kind === "andBranch") {
    return (
      <ConfigSection title="Branches">
        <BranchEditor
          branches={normalizeBranches(config.branches, config.branchesJson)}
          onChange={(branches) => onChange({ branches })}
        />
      </ConfigSection>
    );
  }

  if (kind === "andAll") {
    return (
      <ConfigSection title="Parallel Steps">
        <ParallelStepEditor
          steps={normalizeParallelSteps(config.parallelSteps, config.parallelStepsJson)}
          onChange={(parallelSteps) => onChange({ parallelSteps })}
        />
      </ConfigSection>
    );
  }

  if (kind === "andWhile") {
    return (
      <>
        <ConfigSection title="Condition">
          <ConfigInput
            value={config.condition ?? ""}
            onChange={(value) => onChange({ condition: value })}
          />
        </ConfigSection>
        <ConfigSection title="Max Iterations">
          <input
            type="number"
            min={1}
            max={20}
            value={config.maxIterations ?? 3}
            onChange={(event) => onChange({ maxIterations: Number(event.target.value) || 1 })}
            className="h-10 w-full rounded-lg border border-[#282c31] bg-[#111314] px-3 text-sm font-semibold text-zinc-300 outline-none focus:border-emerald-500/50"
          />
        </ConfigSection>
        <ConfigSection title="Loop Body">
          <ConfigTextarea
            value={config.loopBody ?? ""}
            onChange={(value) => onChange({ loopBody: value })}
            minHeight="min-h-32"
          />
        </ConfigSection>
      </>
    );
  }

  return (
    <ConfigSection title="Map">
      <MapEntryEditor
        entries={normalizeMapEntries(config.mapEntries, config.mapJson)}
        onChange={(mapEntries) => onChange({ mapEntries })}
      />
    </ConfigSection>
  );
}

function ConfigSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{title}</label>
      {children}
    </section>
  );
}

function ConfigTextarea({
  value,
  onChange,
  minHeight,
}: {
  value: string;
  onChange: (value: string) => void;
  minHeight: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${minHeight} w-full resize-none rounded-lg border border-[#282c31] bg-[#111314] p-3 font-mono text-xs leading-5 text-zinc-300 outline-none focus:border-emerald-500/50`}
      spellCheck={false}
    />
  );
}

function ConfigInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-lg border border-[#282c31] bg-[#111314] px-3 font-mono text-xs text-zinc-300 outline-none focus:border-emerald-500/50"
      spellCheck={false}
    />
  );
}

function BranchEditor({
  branches,
  onChange,
}: {
  branches: BranchConfig[];
  onChange: (branches: BranchConfig[]) => void;
}) {
  function updateBranch(id: string, update: Partial<BranchConfig>) {
    onChange(branches.map((branch) => (branch.id === id ? { ...branch, ...update } : branch)));
  }

  function addBranch() {
    onChange([
      ...branches,
      {
        id: createConfigId("branch"),
        name: `Branch ${branches.length + 1}`,
        condition: "true",
        step: "return data",
      },
    ]);
  }

  function removeBranch(id: string) {
    onChange(branches.filter((branch) => branch.id !== id));
  }

  return (
    <div className="space-y-3">
      {branches.map((branch, index) => (
        <div key={branch.id} className="rounded-lg border border-[#282c31] bg-[#111314] p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-zinc-400">Branch {index + 1}</div>
            <button
              onClick={() => removeBranch(branch.id)}
              disabled={branches.length === 1}
              className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <ConfigField label="Name">
              <ConfigInput value={branch.name} onChange={(name) => updateBranch(branch.id, { name })} />
            </ConfigField>
            <ConfigField label="Condition">
              <ConfigInput value={branch.condition} onChange={(condition) => updateBranch(branch.id, { condition })} />
            </ConfigField>
            <ConfigField label="Step">
              <ConfigTextarea
                value={branch.step}
                onChange={(step) => updateBranch(branch.id, { step })}
                minHeight="min-h-24"
              />
            </ConfigField>
          </div>
        </div>
      ))}
      <AddRowButton onClick={addBranch} label="Add Branch" />
    </div>
  );
}

function ParallelStepEditor({
  steps,
  onChange,
}: {
  steps: ParallelStepConfig[];
  onChange: (steps: ParallelStepConfig[]) => void;
}) {
  function updateStep(id: string, update: Partial<ParallelStepConfig>) {
    onChange(steps.map((step) => (step.id === id ? { ...step, ...update } : step)));
  }

  function addStep() {
    onChange([
      ...steps,
      {
        id: createConfigId("parallel"),
        name: `Parallel ${steps.length + 1}`,
        execute: "return data",
      },
    ]);
  }

  function removeStep(id: string) {
    onChange(steps.filter((step) => step.id !== id));
  }

  return (
    <div className="space-y-3">
      {steps.map((step, index) => (
        <div key={step.id} className="rounded-lg border border-[#282c31] bg-[#111314] p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-zinc-400">Parallel {index + 1}</div>
            <button
              onClick={() => removeStep(step.id)}
              disabled={steps.length === 1}
              className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <ConfigField label="Name">
              <ConfigInput value={step.name} onChange={(name) => updateStep(step.id, { name })} />
            </ConfigField>
            <ConfigField label="Execute">
              <ConfigTextarea
                value={step.execute}
                onChange={(execute) => updateStep(step.id, { execute })}
                minHeight="min-h-24"
              />
            </ConfigField>
          </div>
        </div>
      ))}
      <AddRowButton onClick={addStep} label="Add Parallel Step" />
    </div>
  );
}

function MapEntryEditor({
  entries,
  onChange,
}: {
  entries: MapEntryConfig[];
  onChange: (entries: MapEntryConfig[]) => void;
}) {
  function updateEntry(id: string, update: Partial<MapEntryConfig>) {
    onChange(entries.map((entry) => (entry.id === id ? { ...entry, ...update } : entry)));
  }

  function addEntry() {
    onChange([
      ...entries,
      {
        id: createConfigId("map"),
        key: `field${entries.length + 1}`,
        source: "data",
        path: ".",
        value: "",
        stepId: "",
      },
    ]);
  }

  function removeEntry(id: string) {
    onChange(entries.filter((entry) => entry.id !== id));
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-lg border border-[#282c31] bg-[#111314] p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <input
              value={entry.key}
              onChange={(event) => updateEntry(entry.id, { key: event.target.value })}
              className="h-9 min-w-0 flex-1 rounded-md border border-[#282c31] bg-[#0d0f10] px-3 font-mono text-xs font-semibold text-zinc-200 outline-none focus:border-emerald-500/50"
            />
            <button
              onClick={() => removeEntry(entry.id)}
              disabled={entries.length === 1}
              className="grid h-8 w-8 place-items-center rounded-md text-zinc-500 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <select
              value={entry.source}
              onChange={(event) => updateEntry(entry.id, { source: event.target.value as MapEntryConfig["source"] })}
              className="h-9 rounded-md border border-[#282c31] bg-[#0d0f10] px-2 text-xs font-semibold text-zinc-300 outline-none focus:border-emerald-500/50"
            >
              <option value="data">data</option>
              <option value="input">input</option>
              <option value="step">step</option>
              <option value="value">value</option>
            </select>
            {entry.source === "value" ? (
              <input
                value={entry.value}
                onChange={(event) => updateEntry(entry.id, { value: event.target.value })}
                className="h-9 rounded-md border border-[#282c31] bg-[#0d0f10] px-3 font-mono text-xs text-zinc-300 outline-none focus:border-emerald-500/50"
              />
            ) : entry.source === "step" ? (
              <input
                value={entry.stepId}
                onChange={(event) => updateEntry(entry.id, { stepId: event.target.value })}
                placeholder="step id"
                className="h-9 rounded-md border border-[#282c31] bg-[#0d0f10] px-3 font-mono text-xs text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-emerald-500/50"
              />
            ) : (
              <input
                value={entry.path}
                onChange={(event) => updateEntry(entry.id, { path: event.target.value })}
                placeholder="path"
                className="h-9 rounded-md border border-[#282c31] bg-[#0d0f10] px-3 font-mono text-xs text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-emerald-500/50"
              />
            )}
          </div>
          {entry.source === "step" && (
            <input
              value={entry.path}
              onChange={(event) => updateEntry(entry.id, { path: event.target.value })}
              placeholder="output path"
              className="mt-2 h-9 w-full rounded-md border border-[#282c31] bg-[#0d0f10] px-3 font-mono text-xs text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-emerald-500/50"
            />
          )}
        </div>
      ))}
      <AddRowButton onClick={addEntry} label="Add Mapping" />
    </div>
  );
}

function ConfigField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-600">{label}</span>
      {children}
    </label>
  );
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs font-bold text-emerald-300"
    >
      <Plus className="h-4 w-4" />
      {label}
    </button>
  );
}

function RunMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#282c31] bg-[#111314] p-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-600">{label}</div>
      <div className="mt-2 truncate text-sm font-bold text-zinc-200">{value}</div>
    </div>
  );
}

export default function WorkflowPage() {
  const [workflows, setWorkflows] = useState<WorkflowDraft[]>([]);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [templateQuery, setTemplateQuery] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [inspectorTab, setInspectorTab] = useState<"config" | "run">("config");
  const [run, setRun] = useState<WorkflowRunSnapshot | null>(null);
  const [runError, setRunError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(true);
  const [workflowError, setWorkflowError] = useState("");

  const activeWorkflow = workflows.find((workflow) => workflow.id === activeWorkflowId) ?? null;
  const selectedNode = activeWorkflow?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const filteredTemplates = nodeTemplates.filter((template) =>
    `${template.kind} ${template.detail}`.toLowerCase().includes(templateQuery.toLowerCase()),
  );
  const latestEventsByNodeId = useMemo(() => {
    const events = new Map<string, WorkflowRunSnapshot["events"][number]>();
    for (const event of run?.events ?? []) {
      events.set(event.id, event);
    }
    return events;
  }, [run?.events]);
  const flowNodes = useMemo(
    () =>
      (activeWorkflow?.nodes ?? []).map((node) => {
        const event = latestEventsByNodeId.get(node.id);
        return {
          ...node,
          data: {
            ...node.data,
            runStatus: event?.status,
            runDurationMs: event?.durationMs,
          },
        };
      }),
    [activeWorkflow?.nodes, latestEventsByNodeId],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadWorkflows() {
      setIsLoadingWorkflows(true);
      setWorkflowError("");

      try {
        const payload = await requestJson<{ workflows: WorkflowDraft[] }>("/api/workflows");
        if (cancelled) return;

        const normalizedWorkflows = payload.workflows.map(normalizeWorkflow);
        setWorkflows(normalizedWorkflows);
        setActiveWorkflowId(normalizedWorkflows[0]?.id ?? null);
        setSelectedNodeId(normalizedWorkflows[0]?.nodes[0]?.id ?? null);
      } catch (error) {
        if (!cancelled) {
          setWorkflowError(error instanceof Error ? error.message : "Could not load workflows.");
        }
      } finally {
        if (!cancelled) setIsLoadingWorkflows(false);
      }
    }

    void loadWorkflows();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!run || run.status !== "running") return;

    const interval = window.setInterval(async () => {
      try {
        setRun(await fetchWorkflowRun(run.runId));
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Could not refresh workflow run.");
      }
    }, 700);

    return () => window.clearInterval(interval);
  }, [run]);

  async function handleStartRun() {
    if (!activeWorkflow) return;

    setIsStarting(true);
    setRunError("");

    try {
      const workflowToRun = await saveWorkflowDraft(activeWorkflow);
      const nextRun = await requestJson<WorkflowRunSnapshot>("/api/workflows/run", {
        method: "POST",
        body: JSON.stringify({
          workflowId: workflowToRun.id,
          input: {
            title: workflowToRun.name,
            content: workflowToRun.nodes
              .map((node, index) => `${index + 1}. ${node.data.kind}: ${node.data.title} - ${node.data.description}`)
              .join("\n"),
            requireApproval: false,
          },
        }),
      });
      setRun(nextRun);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Could not start workflow.");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleAction(action: "suspend" | "abort" | "retry") {
    if (!run) return;
    setRunError("");

    try {
      const nextRun = await requestJson<WorkflowRunSnapshot>(`/api/workflows/runs/${run.runId}/${action}`, {
        method: "POST",
        body: action === "retry" ? undefined : JSON.stringify({ reason: `${action} from workflow builder` }),
      });
      setRun(nextRun);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : `Could not ${action} workflow.`);
    }
  }

  function updateActiveWorkflow(updater: (workflow: WorkflowDraft) => WorkflowDraft) {
    if (!activeWorkflow) return;

    setSaveState("idle");
    setWorkflows((current) =>
      current.map((workflow) => (workflow.id === activeWorkflow.id ? updater(workflow) : workflow)),
    );
  }

  async function handleNewWorkflow() {
    setWorkflowError("");

    try {
      const nextWorkflow = normalizeWorkflow(await requestJson<WorkflowDraft>("/api/workflows", {
        method: "POST",
        body: JSON.stringify({
          id: createWorkflowId(),
          name: createWorkflowName(workflows.length + 1),
          nodes: [],
          edges: [],
          nextNodeIndex: 1,
        }),
      }));

      setWorkflows((current) => [nextWorkflow, ...current]);
      setActiveWorkflowId(nextWorkflow.id);
      setSelectedNodeId(null);
      setRun(null);
      setRunError("");
      setSaveState("saved");
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Could not create workflow.");
    }
  }

  function handleSelectWorkflow(workflow: WorkflowDraft) {
    setActiveWorkflowId(workflow.id);
    setSelectedNodeId(workflow.nodes[0]?.id ?? null);
    setRun(null);
    setRunError("");
  }

  function handleNodesChange(changes: NodeChange<BuilderNode>[]) {
    updateActiveWorkflow((workflow) => ({
      ...workflow,
      nodes: applyNodeChanges(changes, workflow.nodes),
    }));
  }

  function handleEdgesChange(changes: EdgeChange[]) {
    updateActiveWorkflow((workflow) => ({
      ...workflow,
      edges: applyEdgeChanges(changes, workflow.edges),
    }));
  }

  function handleConnect(connection: Connection) {
    updateActiveWorkflow((workflow) => ({
      ...workflow,
      edges: addEdge(
        {
          ...connection,
          id: `${connection.source}-${connection.target}-${Date.now()}`,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, color: "#35d49a" },
        },
        workflow.edges,
      ),
    }));
  }

  function handleAddNode(template: (typeof nodeTemplates)[number]) {
    updateActiveWorkflow((workflow) => {
      const nodeId = `${template.kind.toLowerCase()}-${workflow.nextNodeIndex}`;
      const lastNode = workflow.nodes.at(-1);
      const nextNode: BuilderNode = {
        id: nodeId,
        type: "builderNode",
        position: {
          x: 80 + workflow.nodes.length * 320,
          y: workflow.nodes.length % 2 === 0 ? 160 : 320,
        },
        data: {
          title: template.title,
          kind: template.kind,
          description: template.description,
          accent: kindToAccent(template.kind),
          config: defaultStepConfigs[template.kind],
        },
      };

      const nextEdges =
        lastNode && lastNode.id !== nextNode.id
          ? [
              ...workflow.edges,
              {
                id: `${lastNode.id}-${nextNode.id}`,
                source: lastNode.id,
                target: nextNode.id,
                type: "smoothstep",
                markerEnd: { type: MarkerType.ArrowClosed, color: "#35d49a" },
              },
            ]
          : workflow.edges;

      setSelectedNodeId(nextNode.id);
      return {
        ...workflow,
        nodes: [...workflow.nodes, nextNode],
        edges: nextEdges,
        nextNodeIndex: workflow.nextNodeIndex + 1,
      };
    });
  }

  function updateSelectedNodeData(update: Partial<BuilderNodeData>) {
    if (!selectedNode) return;

    updateActiveWorkflow((workflow) => ({
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                ...update,
                accent: update.kind ? kindToAccent(update.kind) : (update.accent ?? node.data.accent),
                config: update.kind
                  ? normalizeStepConfig(update.kind, node.data.config)
                  : node.data.config,
              },
            }
          : node,
      ),
    }));
  }

  function updateWorkflowName(name: string) {
    updateActiveWorkflow((workflow) => ({
      ...workflow,
      name: name.trimStart() || workflow.name,
    }));
  }

  function handleDeleteSelectedNode() {
    if (!selectedNode) return;

    updateActiveWorkflow((workflow) => ({
      ...workflow,
      nodes: workflow.nodes.filter((node) => node.id !== selectedNode.id),
      edges: workflow.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id),
    }));
    setSelectedNodeId(null);
  }

  function updateSelectedNodeConfig(update: Partial<StepConfig>) {
    if (!selectedNode) return;

    updateActiveWorkflow((workflow) => ({
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                config: {
                  ...defaultStepConfigs[node.data.kind],
                  ...node.data.config,
                  ...update,
                },
              },
            }
          : node,
      ),
    }));
  }

  async function saveWorkflowDraft(workflow: WorkflowDraft) {
    setSaveState("saving");
    setWorkflowError("");

    const savedWorkflow = normalizeWorkflow(await requestJson<WorkflowDraft>(`/api/workflows/${workflow.id}`, {
      method: "PUT",
      body: JSON.stringify(workflow),
    }));
    setWorkflows((current) =>
      current.map((currentWorkflow) => (currentWorkflow.id === savedWorkflow.id ? savedWorkflow : currentWorkflow)),
    );
    setSaveState("saved");
    return savedWorkflow;
  }

  async function handleSaveWorkflow() {
    if (!activeWorkflow) return;

    try {
      await saveWorkflowDraft(activeWorkflow);
    } catch (error) {
      setSaveState("idle");
      setWorkflowError(error instanceof Error ? error.message : "Could not save workflow.");
    }
  }

  return (
    <ReactFlowProvider>
      <main className="h-screen overflow-hidden bg-[#111314] text-zinc-100">
        <header className="flex h-14 items-center justify-between border-b border-[#25282c] bg-[#151718] px-5">
          <div className="flex min-w-0 items-center gap-4">
            <div className="text-base font-bold">Workflow Builder</div>
            <button className="flex h-9 max-w-[320px] items-center gap-2 rounded-lg border border-[#2a2e33] bg-[#1b1e21] px-3 text-sm font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="truncate">{activeWorkflow?.name ?? "No workflow"}</span>
              <ChevronDown className="h-4 w-4 text-zinc-500" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartRun}
              disabled={isStarting || !activeWorkflow || activeWorkflow.nodes.length === 0}
              className="flex h-9 items-center gap-2 rounded-lg border border-[#2a2e33] bg-[#1b1e21] px-3 text-sm font-semibold text-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="h-4 w-4" />
              {isStarting ? "Starting" : "Test"}
            </button>
            <button
              onClick={() => handleAction("suspend")}
              disabled={!run || run.status !== "running"}
              className="flex h-9 items-center gap-2 rounded-lg border border-[#2a2e33] bg-[#1b1e21] px-3 text-sm font-semibold text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PauseCircle className="h-4 w-4" />
              Suspend
            </button>
            <button
              onClick={() => handleAction("abort")}
              disabled={!run || run.status !== "running"}
              className="flex h-9 items-center gap-2 rounded-lg border border-[#2a2e33] bg-[#1b1e21] px-3 text-sm font-semibold text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <OctagonX className="h-4 w-4" />
              Abort
            </button>
            <button
              onClick={() => handleAction("retry")}
              disabled={!run || run.status === "running"}
              className="flex h-9 items-center gap-2 rounded-lg border border-[#2a2e33] bg-[#1b1e21] px-3 text-sm font-semibold text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
              Retry
            </button>
            <button
              onClick={handleSaveWorkflow}
              disabled={!activeWorkflow || saveState === "saving"}
              className="flex h-9 items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm font-semibold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : "Save"}
            </button>
          </div>
        </header>

        <div className="grid h-[calc(100vh-56px)] grid-cols-[280px_1fr_320px]">
          <aside className="border-r border-[#25282c] bg-[#151718]">
            <div className="border-b border-[#25282c] p-4">
              <button
                onClick={handleNewWorkflow}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 text-sm font-bold text-[#062414]"
              >
                <Plus className="h-4 w-4" />
                New Workflow
              </button>
            </div>

            <div className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Workflows</div>
                <ListFilter className="h-4 w-4 text-zinc-500" />
              </div>
              <div className="space-y-1">
                {isLoadingWorkflows && <div className="px-3 py-2 text-sm text-zinc-500">Loading workflows...</div>}
                {!isLoadingWorkflows && workflows.length === 0 && (
                  <div className="rounded-lg border border-dashed border-[#30343a] p-3 text-sm text-zinc-500">
                    Create your first workflow.
                  </div>
                )}
                {workflows.map((workflow) => (
                  <button
                    key={workflow.id}
                    onClick={() => handleSelectWorkflow(workflow)}
                    className={`flex h-9 w-full items-center justify-between rounded-md px-3 text-left text-sm font-semibold ${
                      workflow.id === activeWorkflowId
                        ? "bg-[#212427] text-emerald-300"
                        : "text-zinc-400 hover:bg-[#1d2023] hover:text-zinc-200"
                    }`}
                  >
                    <span className="truncate">{workflow.name}</span>
                    {workflow.id === activeWorkflowId && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>
              {workflowError && <div className="mt-3 text-xs font-semibold text-red-300">{workflowError}</div>}
            </div>

            <div className="border-t border-[#25282c] p-4">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Add Node</div>
              <div className="space-y-2">
                {filteredTemplates.map((template) => (
                  <button
                    key={template.kind}
                    onClick={() => handleAddNode(template)}
                    disabled={!activeWorkflow}
                    className="flex w-full items-center gap-3 rounded-lg border border-[#282c31] bg-[#191b1e] p-3 text-left hover:border-emerald-500/35 hover:bg-emerald-500/5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#24282d] text-emerald-300">
                      <template.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-zinc-200">{template.kind}</span>
                      <span className="block truncate text-xs text-zinc-500">{template.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="min-w-0">
            <div className="flex h-12 items-center justify-between border-b border-[#25282c] bg-[#131516] px-4">
              <label className="flex items-center gap-2 rounded-lg border border-[#282c31] bg-[#191b1e] px-3 py-2 text-sm text-zinc-500">
                <Search className="h-4 w-4" />
                <input
                  value={templateQuery}
                  onChange={(event) => setTemplateQuery(event.target.value)}
                  className="w-40 bg-transparent text-zinc-300 outline-none placeholder:text-zinc-600"
                  placeholder="Search nodes"
                />
              </label>
              <div className="flex items-center gap-2">
                <button className="grid h-8 w-8 place-items-center rounded-md border border-[#282c31] bg-[#191b1e] text-zinc-400">
                  <Settings2 className="h-4 w-4" />
                </button>
                <button
                  onClick={handleDeleteSelectedNode}
                  disabled={!selectedNode}
                  className="grid h-8 w-8 place-items-center rounded-md border border-[#282c31] bg-[#191b1e] text-zinc-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="relative h-[calc(100%-48px)]">
              <ReactFlow
                nodes={flowNodes}
                edges={activeWorkflow?.edges ?? []}
                nodeTypes={nodeTypes}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={handleConnect}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                defaultViewport={{ x: 40, y: 80, zoom: 1 }}
                minZoom={0.5}
                maxZoom={1.4}
                defaultEdgeOptions={{
                  style: { stroke: "#35d49a", strokeWidth: 1.6 },
                }}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#363a40" gap={24} size={1.3} variant={BackgroundVariant.Dots} />
                <Controls
                  className="!bottom-5 !left-5 !rounded-md !border !border-[#2a2e33] !bg-[#17191b] [&_button]:!border-[#2a2e33] [&_button]:!bg-[#17191b] [&_button]:!text-zinc-300"
                  showInteractive={false}
                />
              </ReactFlow>
              {!activeWorkflow && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="rounded-lg border border-dashed border-[#343941] bg-[#151718]/90 px-5 py-4 text-center">
                    <div className="text-sm font-semibold text-zinc-200">No workflow selected</div>
                    <div className="mt-1 text-xs text-zinc-500">Create a workflow to start adding nodes.</div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="overflow-y-auto border-l border-[#25282c] bg-[#151718]">
            <div className="border-b border-[#25282c] px-4 py-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <PanelRight className="h-4 w-4 text-emerald-300" />
                Inspector
              </div>
              <div className="grid grid-cols-2 rounded-lg border border-[#282c31] bg-[#111314] p-1">
                <button
                  onClick={() => setInspectorTab("config")}
                  className={`h-8 rounded-md text-xs font-bold ${
                    inspectorTab === "config" ? "bg-emerald-500 text-[#062414]" : "text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  Config
                </button>
                <button
                  onClick={() => setInspectorTab("run")}
                  className={`h-8 rounded-md text-xs font-bold ${
                    inspectorTab === "run" ? "bg-emerald-500 text-[#062414]" : "text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  Run
                </button>
              </div>
            </div>
            <div className="space-y-5 p-4">
              {inspectorTab === "config" && (
                <>
                  <section>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Workflow</label>
                    <input
                      value={activeWorkflow?.name ?? ""}
                      onChange={(event) => updateWorkflowName(event.target.value)}
                      disabled={!activeWorkflow}
                      className="w-full rounded-lg border border-[#282c31] bg-[#111314] px-3 py-2 text-sm font-semibold text-zinc-200 outline-none focus:border-emerald-500/50 disabled:opacity-50"
                      placeholder="Workflow name"
                    />
                  </section>

                  <div className="border-t border-[#25282c]" />

                  {!selectedNode && (
                    <section className="rounded-lg border border-dashed border-[#30343a] p-4 text-sm text-zinc-500">
                      Select a node to edit its settings.
                    </section>
                  )}

                  {selectedNode && (
                    <>
                      <section>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Name</label>
                        <input
                          value={selectedNode.data.title}
                          onChange={(event) => updateSelectedNodeData({ title: event.target.value })}
                          className="w-full rounded-lg border border-[#282c31] bg-[#111314] px-3 py-2 text-sm font-semibold text-zinc-200 outline-none focus:border-emerald-500/50"
                        />
                      </section>
                      <section>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Node Type</label>
                        <select
                          value={selectedNode.data.kind}
                          onChange={(event) => updateSelectedNodeData({ kind: event.target.value as NodeKind })}
                          className="h-10 w-full rounded-lg border border-[#282c31] bg-[#111314] px-3 text-sm font-semibold text-zinc-300 outline-none focus:border-emerald-500/50"
                        >
                          {nodeKinds.map((kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ))}
                        </select>
                      </section>
                      <StepConfigFields
                        kind={selectedNode.data.kind}
                        config={{
                          ...defaultStepConfigs[selectedNode.data.kind],
                          ...selectedNode.data.config,
                        }}
                        onChange={updateSelectedNodeConfig}
                      />
                      <button
                        onClick={handleDeleteSelectedNode}
                        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 text-sm font-bold text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete Node
                      </button>
                    </>
                  )}
                </>
              )}

              {inspectorTab === "run" && (
                <>
                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Run</div>
                      <span className={`rounded-md px-2 py-1 text-xs font-bold ${runStatusClass(run?.status)}`}>
                        {run?.status ?? "idle"}
                      </span>
                    </div>
                    {runError && (
                      <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-semibold text-red-300">
                        {runError}
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      <RunMetric label="Steps" value={String(run?.events.length ?? 0)} />
                      <RunMetric label="Input" value={formatToken(run?.usage.inputTokens)} />
                      <RunMetric label="Output" value={formatToken(run?.usage.outputTokens)} />
                    </div>
                    <div className="mt-3 rounded-lg border border-[#282c31] bg-[#111314] p-3">
                      <div className="mb-2 text-xs text-zinc-500">Run ID</div>
                      <div className="truncate font-mono text-xs text-zinc-300">{run?.runId ?? "No run yet"}</div>
                      {run?.error && <div className="mt-2 text-xs font-semibold text-red-300">{run.error}</div>}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Result</div>
                    <pre className="max-h-64 overflow-auto rounded-lg border border-[#282c31] bg-[#0f1112] p-3 font-mono text-xs leading-5 text-zinc-300">
                      {run?.result !== undefined ? formatJson(run.result) : "Run the workflow to inspect the final output."}
                    </pre>
                  </section>

                  <section>
                    <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Steps</div>
                    <div className="space-y-2">
                      {(run?.events.length ? run.events : []).map((event, index) => (
                        <div key={`${event.path}-${event.attempt}-${index}`} className="rounded-lg border border-[#282c31] bg-[#111314] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-zinc-200">{event.name}</div>
                              <div className="mt-1 text-xs text-zinc-500">
                                {event.type} · attempt {event.attempt}
                              </div>
                            </div>
                            <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ${stepStatusClass(event.status)}`}>
                              {event.status}
                            </span>
                          </div>
                          {event.durationMs !== undefined && (
                            <div className="mt-2 text-xs text-zinc-500">{event.durationMs}ms</div>
                          )}
                          {event.usage && (
                            <div className="mt-2 text-xs text-zinc-500">
                              tokens {formatToken(event.usage.totalTokens)}
                            </div>
                          )}
                          {event.error && <div className="mt-2 text-xs text-red-300">{event.error}</div>}
                          {event.output !== undefined && (
                            <pre className="mt-3 max-h-32 overflow-auto rounded-md bg-[#0b0d0e] p-2 font-mono text-[11px] leading-4 text-zinc-400">
                              {formatJson(event.output)}
                            </pre>
                          )}
                        </div>
                      ))}
                      {!run?.events.length && (
                        <div className="rounded-lg border border-dashed border-[#30343a] p-4 text-sm text-zinc-500">
                          Click Test to run the workflow.
                        </div>
                      )}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Trace</div>
                    <div className="space-y-2">
                      {(run?.traces.length ? run.traces : []).map((trace) => (
                        <div key={trace.id} className="rounded-lg border border-[#282c31] bg-[#111314] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="truncate text-xs font-semibold text-zinc-200">{trace.name}</div>
                            <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ${traceStatusClass(trace.status)}`}>
                              {trace.status}
                            </span>
                          </div>
                          <div className="mt-2 text-xs leading-5 text-zinc-500">{trace.detail}</div>
                        </div>
                      ))}
                      {!run?.traces.length && (
                        <div className="rounded-lg border border-dashed border-[#30343a] p-4 text-sm text-zinc-500">
                          Trace events will appear here while the workflow runs.
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>
          </aside>
        </div>
      </main>
    </ReactFlowProvider>
  );
}

async function fetchWorkflowRun(runId: string) {
  return requestJson<WorkflowRunSnapshot>(`/api/workflows/runs/${runId}`);
}

async function requestJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(typeof payload.message === "string" ? payload.message : "Request failed.");
  }

  return payload as T;
}

function runStatusClass(status?: WorkflowRunSnapshot["status"]) {
  if (status === "succeeded") return "bg-emerald-500/10 text-emerald-300";
  if (status === "running") return "bg-sky-500/10 text-sky-300";
  if (status === "suspended") return "bg-amber-500/10 text-amber-300";
  if (status === "failed" || status === "aborted") return "bg-red-500/10 text-red-300";
  return "bg-[#222529] text-zinc-400";
}

function stepStatusClass(status: string) {
  if (status === "succeeded") return "bg-emerald-500/10 text-emerald-300";
  if (status === "running") return "bg-sky-500/10 text-sky-300";
  if (status === "suspended") return "bg-amber-500/10 text-amber-300";
  if (status === "failed" || status === "aborted") return "bg-red-500/10 text-red-300";
  return "bg-[#222529] text-zinc-400";
}

function traceStatusClass(status: string) {
  if (status === "done") return "bg-emerald-500/10 text-emerald-300";
  if (status === "running" || status === "queued") return "bg-sky-500/10 text-sky-300";
  if (status === "error") return "bg-red-500/10 text-red-300";
  return "bg-[#222529] text-zinc-400";
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatToken(value: number | undefined) {
  return value === undefined ? "0" : String(value);
}
