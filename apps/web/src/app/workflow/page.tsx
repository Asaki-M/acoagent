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
  Map,
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
import { useEffect, useState } from "react";

type BuilderNodeData = {
  title: string;
  kind: NodeKind;
  description: string;
  accent: "green" | "violet" | "blue";
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
    error?: string;
  }>;
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
    icon: Map,
  },
];

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
        },
      };
    }),
  };
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

  return (
    <div
      className={`w-[280px] rounded-lg border bg-[#17191b] shadow-xl shadow-black/20 transition ${
        selected ? "border-emerald-400 ring-2 ring-emerald-400/20" : "border-[#2a2e33]"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-zinc-500 !bg-[#111]" />
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <span className={`mb-3 inline-flex rounded-md border px-2 py-1 text-[11px] font-bold ${accent}`}>{data.kind}</span>
          <div className="truncate text-sm font-semibold text-zinc-100">{data.title}</div>
          <div className="mt-1 truncate text-xs text-zinc-500">{data.description}</div>
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

export default function WorkflowPage() {
  const [workflows, setWorkflows] = useState<WorkflowDraft[]>([]);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [templateQuery, setTemplateQuery] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
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
      const nextRun = await requestJson<WorkflowRunSnapshot>("/api/workflows/run", {
        method: "POST",
        body: JSON.stringify({
          workflowId: activeWorkflow.id,
          input: {
            title: activeWorkflow.name,
            content: activeWorkflow.nodes
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

  async function handleSaveWorkflow() {
    if (!activeWorkflow) return;

    setSaveState("saving");
    setWorkflowError("");

    try {
      const savedWorkflow = normalizeWorkflow(await requestJson<WorkflowDraft>(`/api/workflows/${activeWorkflow.id}`, {
        method: "PUT",
        body: JSON.stringify(activeWorkflow),
      }));
      setWorkflows((current) =>
        current.map((workflow) => (workflow.id === savedWorkflow.id ? savedWorkflow : workflow)),
      );
      setSaveState("saved");
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
                nodes={activeWorkflow?.nodes ?? []}
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
            <div className="flex h-12 items-center gap-2 border-b border-[#25282c] px-4 text-sm font-semibold">
              <PanelRight className="h-4 w-4 text-emerald-300" />
              Node Settings
            </div>
            <div className="space-y-5 p-4">
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
                  <section>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Description</label>
                    <textarea
                      value={selectedNode.data.description}
                      onChange={(event) => updateSelectedNodeData({ description: event.target.value })}
                      className="min-h-28 w-full resize-none rounded-lg border border-[#282c31] bg-[#111314] p-3 text-sm leading-6 text-zinc-300 outline-none focus:border-emerald-500/50"
                    />
                  </section>
                  <button
                    onClick={handleDeleteSelectedNode}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 text-sm font-bold text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Node
                  </button>
                </>
              )}

              <section className="border-t border-[#25282c] pt-5">
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
                <div className="rounded-lg border border-[#282c31] bg-[#111314] p-3">
                  <div className="mb-2 text-xs text-zinc-500">Run ID</div>
                  <div className="truncate font-mono text-xs text-zinc-300">{run?.runId ?? "No run yet"}</div>
                </div>
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
                      {event.error && <div className="mt-2 text-xs text-red-300">{event.error}</div>}
                    </div>
                  ))}
                  {!run?.events.length && (
                    <div className="rounded-lg border border-dashed border-[#30343a] p-4 text-sm text-zinc-500">
                      Click Test to run the nested workflow.
                    </div>
                  )}
                </div>
              </section>
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
