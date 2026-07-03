"use client";

import MarkdownRender from "markstream-react";
import {
  Bot,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Code2,
  FileCode2,
  FileText,
  FolderOpen,
  FolderPlus,
  History,
  Loader2,
  MessageSquarePlus,
  Play,
  Search,
  Sparkles,
  TerminalSquare,
  Workflow,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ProjectFile = {
  path: string;
  name: string;
  size: number;
  language: string;
  content: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  done?: boolean;
};

type TraceEvent = {
  id: string;
  name: string;
  status: "queued" | "running" | "done" | "error";
  detail: string;
  time: string;
};

type SessionSummary = {
  projectPath: string;
  sessionId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  traceCount: number;
  lastMessage: string | null;
};

type ConversationStep = {
  id: number | string;
  title: string;
  status: "running" | "done" | "error";
  userMessageId: number | null;
  assistantMessageId: number | null;
  createdAt?: string;
  updatedAt?: string;
};

type FileSystemFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
};

type FileSystemDirectoryHandle = {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
};

type FileTreeNode = {
  name: string;
  path: string;
  type: "directory" | "file";
  children: FileTreeNode[];
  file?: ProjectFile;
};

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

const MAX_FILE_SIZE = 120_000;
const MAX_CONTEXT_CHARS = 90_000;
const MAX_FILES = 80;
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8787";

const textExtensions = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "graphql",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "md",
  "mdx",
  "mjs",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

const ignoredPathParts = [
  "/.git/",
  "/.next/",
  "/dist/",
  "/build/",
  "/coverage/",
  "/node_modules/",
  "/out/",
];

const ignoredDirectoryNames = new Set([".git", ".next", "dist", "build", "coverage", "node_modules", "out"]);
const INITIAL_TRACE_TIME = "Ready";

function now() {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function languageFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "tsx" || ext === "jsx") return "React";
  if (ext === "ts") return "TypeScript";
  if (ext === "js" || ext === "mjs") return "JavaScript";
  if (ext === "py") return "Python";
  if (ext === "md" || ext === "mdx") return "Markdown";
  if (ext === "json") return "JSON";
  if (ext === "css" || ext === "scss") return "Styles";
  return ext ? ext.toUpperCase() : "Text";
}

function isUsefulTextFile(file: File, path: string) {
  const normalizedPath = `/${path}`;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return (
    file.size > 0 &&
    file.size <= MAX_FILE_SIZE &&
    textExtensions.has(ext) &&
    !ignoredPathParts.some((part) => normalizedPath.includes(part))
  );
}

function scoreFile(file: ProjectFile, query: string) {
  const haystack = `${file.path}\n${file.content.slice(0, 3000)}`.toLowerCase();
  const words = query
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 2);
  return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

function buildContext(files: ProjectFile[], question: string) {
  let used = 0;
  return [...files]
    .sort((a, b) => scoreFile(b, question) - scoreFile(a, question) || a.path.localeCompare(b.path))
    .slice(0, 18)
    .map((file) => {
      const remaining = MAX_CONTEXT_CHARS - used;
      const content = file.content.slice(0, Math.max(0, Math.min(file.content.length, remaining)));
      used += content.length;
      return { ...file, content };
    })
    .filter((file) => file.content.length > 0);
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadSessionId() {
  if (typeof window === "undefined") return uid("session");
  const existing = window.localStorage.getItem("ai-platform-session-id");
  if (existing) return existing;

  const created = uid("session");
  window.localStorage.setItem("ai-platform-session-id", created);
  return created;
}

function welcomeMessage(content?: string): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    done: true,
    content:
      content ??
      "Import a local project, then ask about architecture, implementation details, bugs, or refactor paths. The Next.js app sends normalized code context to the Hono API and renders the streamed model response.",
  };
}

function compactSessionId(sessionId: string) {
  return sessionId.replace("session-", "").slice(0, 12);
}

function sessionPreview(session: SessionSummary) {
  if (session.lastMessage?.trim()) return session.lastMessage.trim();
  return session.messageCount ? `${session.messageCount} persisted messages` : "Empty session";
}

function stepLabel(step: ConversationStep) {
  return step.title.length > 42 ? `${step.title.slice(0, 39)}...` : step.title;
}

async function readLocalDirectory(root: FileSystemDirectoryHandle) {
  const imported: ProjectFile[] = [];

  async function walk(directory: FileSystemDirectoryHandle, parentPath: string) {
    for await (const [name, handle] of directory.entries()) {
      if (imported.length >= MAX_FILES) return;

      const path = `${parentPath}/${name}`;
      if (handle.kind === "directory") {
        if (!ignoredDirectoryNames.has(name)) {
          await walk(handle, path);
        }
        continue;
      }

      const file = await handle.getFile();
      if (!isUsefulTextFile(file, path)) continue;

      imported.push({
        path,
        name: file.name,
        size: file.size,
        language: languageFor(path),
        content: await file.text(),
      });
    }
  }

  await walk(root, root.name);
  return imported;
}

function buildFileTree(files: ProjectFile[]) {
  const root: FileTreeNode = {
    name: "root",
    path: "",
    type: "directory",
    children: [],
  };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;

    for (const [index, part] of parts.entries()) {
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      let child = current.children.find((node) => node.name === part && node.type === (isFile ? "file" : "directory"));

      if (!child) {
        child = {
          name: part,
          path,
          type: isFile ? "file" : "directory",
          children: [],
          file: isFile ? file : undefined,
        };
        current.children.push(child);
        current.children.sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      }

      current = child;
    }
  }

  return root.children;
}

export default function Home() {
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [projectName, setProjectName] = useState("No project loaded");
  const [sessionId, setSessionId] = useState("session-pending");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [steps, setSteps] = useState<ConversationStep[]>([]);
  const [activeStepId, setActiveStepId] = useState<number | string | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage()]);
  const [trace, setTrace] = useState<TraceEvent[]>([
    {
      id: "idle",
      name: "workspace.ready",
      status: "done",
      detail: "Waiting for a local project import.",
      time: INITIAL_TRACE_TIME,
    },
  ]);
  const [isImporting, setIsImporting] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [error, setError] = useState("");

  const stats = useMemo(() => {
    const languages = new Map<string, number>();
    let totalSize = 0;
    for (const file of files) {
      languages.set(file.language, (languages.get(file.language) ?? 0) + 1);
      totalSize += file.size;
    }
    return {
      totalSize,
      languages: [...languages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  }, [files]);

  const fileTree = useMemo(() => buildFileTree(files), [files]);

  useEffect(() => {
    setSessionId(loadSessionId());
  }, []);

  useEffect(() => {
    if (!isAnswering) return;
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [isAnswering, messages]);

  async function refreshSessions(projectPath = projectName) {
    if (!projectPath || projectPath === "No project loaded") {
      setSessions([]);
      return [];
    }

    setIsLoadingSessions(true);
    try {
      const params = new URLSearchParams({ projectPath });
      const response = await fetch(`${API_BASE_URL}/api/sessions?${params.toString()}`);
      if (!response.ok) throw new Error(`Could not load sessions (${response.status}).`);
      const payload = (await response.json()) as { sessions?: SessionSummary[] };
      const nextSessions = payload.sessions ?? [];
      setSessions(nextSessions);
      return nextSessions;
    } finally {
      setIsLoadingSessions(false);
    }
  }

  async function loadSessionHistory(nextSessionId: string, projectPath = projectName) {
    if (!projectPath || projectPath === "No project loaded") return;

    setError("");
    const params = new URLSearchParams({
      projectName: projectPath,
      projectPath,
      sessionId: nextSessionId,
    });
    const response = await fetch(`${API_BASE_URL}/api/history?${params.toString()}`);
    if (!response.ok) throw new Error(`Could not load session history (${response.status}).`);

    const payload = (await response.json()) as {
      messages?: Array<{ id: number; role: "user" | "assistant"; content: string }>;
      steps?: ConversationStep[];
      traces?: TraceEvent[];
    };
    const restoredMessages =
      payload.messages?.map((message) => ({
        id: `history-${message.id}`,
        role: message.role,
        content: message.content,
        done: true,
      })) ?? [];

    setSessionId(nextSessionId);
    window.localStorage.setItem("ai-platform-session-id", nextSessionId);
    setSteps(payload.steps ?? []);
    setActiveStepId(payload.steps?.[0]?.id ?? null);
    setMessages(restoredMessages.length ? restoredMessages : [welcomeMessage("This session is empty. Ask a question to start it.")]);
    setTrace(
      payload.traces?.length
        ? [...payload.traces].reverse()
        : [
            {
              id: uid("trace"),
              name: "memory.session",
              status: "done",
              detail: "Loaded an empty project-scoped memory session.",
              time: now(),
            },
          ],
    );
  }

  function focusStep(step: ConversationStep) {
    setActiveStepId(step.id);
    const target = step.userMessageId ? document.getElementById(`message-history-${step.userMessageId}`) : chatEndRef.current;
    target?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  async function handleOpenLocalDirectory() {
    const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
    if (!picker) {
      setError("This browser does not support local directory handles. Use Chrome or Edge on localhost.");
      return;
    }

    setIsImporting(true);
    setError("");
    setTrace([
      {
        id: uid("trace"),
        name: "project.scan",
        status: "running",
        detail: "Reading local directory handle in the browser.",
        time: now(),
      },
    ]);

    try {
      const directory = await picker();
      const imported = await readLocalDirectory(directory);
      const root = directory.name || imported[0]?.path.split("/")[0] || "Local project";
      setFiles(imported);
      setProjectName(root);
      setExpandedPaths(new Set([root]));
      await refreshSessions(root);
      setTrace((current) => [
        ...current.map((item) =>
          item.name === "project.scan"
            ? {
                ...item,
                status: "done" as const,
                detail: `Indexed ${imported.length} text files for MVP context.`,
              }
            : item,
        ),
        {
          id: uid("trace"),
          name: "context.index",
          status: "done",
          detail: "Directory tree and context ranking are ready.",
          time: now(),
        },
      ]);
    } catch (importError) {
      if (importError instanceof DOMException && importError.name === "AbortError") {
        setTrace((current) =>
          current.map((item) =>
            item.name === "project.scan" ? { ...item, status: "queued" as const, detail: "Directory selection cancelled." } : item,
          ),
        );
        return;
      }
      setError(importError instanceof Error ? importError.message : "Could not import the project.");
      setTrace((current) =>
        current.map((item) =>
          item.name === "project.scan"
            ? { ...item, status: "error" as const, detail: "Directory import failed." }
            : item,
        ),
      );
  } finally {
      setIsImporting(false);
    }
  }

  async function handleNewSession() {
    if (projectName === "No project loaded") {
      setError("Open a project before creating a memory session.");
      return;
    }

    const nextSessionId = uid("session");
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName,
          projectPath: projectName,
          sessionId: nextSessionId,
        }),
      });

      if (!response.ok) throw new Error(`Could not create session (${response.status}).`);
      const payload = (await response.json()) as { trace?: TraceEvent };

      window.localStorage.setItem("ai-platform-session-id", nextSessionId);
      setSessionId(nextSessionId);
      setSteps([]);
      setActiveStepId(null);
      setMessages([welcomeMessage("New memory session started for this project. Ask a question to begin a fresh thread.")]);
      setTrace(
        payload.trace
          ? [payload.trace]
          : [
              {
                id: uid("trace"),
                name: "session.create",
                status: "done",
                detail: "Created a new project-scoped memory session.",
                time: now(),
              },
            ],
      );
      await refreshSessions(projectName);
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Could not create a new session.");
    }
  }

  function toggleDirectory(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function appendTrace(event: TraceEvent) {
    setTrace((current) => [event, ...current].slice(0, 30));
  }

  function applyAssistantDelta(id: string, delta: string, done = false) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? {
              ...message,
              content: message.content + delta,
              done: done || message.done,
            }
          : message,
      ),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isAnswering) return;

    const selectedFiles = buildContext(files, trimmed);
    const assistantId = uid("assistant");
    const optimisticStepId = uid("step");
    setQuestion("");
    setError("");
    setIsAnswering(true);
    setActiveStepId(optimisticStepId);
    setSteps((current) => [
      ...current,
      {
        id: optimisticStepId,
        title: trimmed,
        status: "running",
        userMessageId: null,
        assistantMessageId: null,
      },
    ]);
    setMessages((current) => [
      ...current,
      { id: uid("user"), role: "user", content: trimmed, done: true },
      { id: assistantId, role: "assistant", content: "", done: false },
    ]);
    setTrace([
      {
        id: uid("trace"),
        name: "context.select",
        status: "done",
        detail: `Packed ${selectedFiles.length || 0} files for this question.`,
        time: now(),
      },
    ]);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName,
          projectPath: projectName,
          sessionId,
          question: trimmed,
          files: selectedFiles.map((file) => ({
            path: file.path,
            language: file.language,
            content: file.content,
          })),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Chat request failed with ${response.status}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
          const data = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!eventName || !data) continue;

          if (eventName === "delta") {
            applyAssistantDelta(assistantId, JSON.parse(data).content ?? "");
          }
          if (eventName === "trace") {
            appendTrace(JSON.parse(data));
          }
          if (eventName === "done") {
            applyAssistantDelta(assistantId, "", true);
          }
          if (eventName === "error") {
            const payload = JSON.parse(data) as { message?: string };
            throw new Error(payload.message ?? "The assistant run failed.");
          }
        }
      }
      applyAssistantDelta(assistantId, "", true);
    } catch (chatError) {
      const message = chatError instanceof Error ? chatError.message : "The assistant run failed.";
      setError(message);
      setSteps((current) =>
        current.map((step) => (step.id === optimisticStepId ? { ...step, status: "error" as const } : step)),
      );
      applyAssistantDelta(assistantId, `\n\n**Run failed:** ${message}`, true);
      appendTrace({
        id: uid("trace"),
        name: "run.error",
        status: "error",
        detail: message,
        time: now(),
      });
    } finally {
      if (projectName !== "No project loaded") {
        try {
          await refreshSessions(projectName);
          await loadSessionHistory(sessionId, projectName);
        } catch {
          // The active answer is more important than a stale session list.
        }
      }
      setIsAnswering(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f5f1] text-[#191919]">
      <div className="flex min-h-screen flex-col">
        <header className="flex h-16 items-center justify-between border-b border-black/10 bg-[#fdfcf8]/85 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-[#191919] text-white">
              <Braces size={18} aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">AI Code Platform</h1>
              <p className="truncate text-xs text-black/55">Local project Q&A with tool trace</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleNewSession()}
              disabled={projectName === "No project loaded"}
              className="inline-flex h-9 items-center justify-center rounded-md border border-black/10 bg-white px-3 text-sm font-medium text-black/70 transition hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:text-black/25"
              aria-label="New memory session"
              title="New memory session"
            >
              <MessageSquarePlus size={16} />
            </button>
            <button
              type="button"
              onClick={() => void handleOpenLocalDirectory()}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1f6f5f] px-3 text-sm font-medium text-white transition hover:bg-[#18584b]"
            >
              {isImporting ? <Loader2 className="animate-spin" size={16} /> : <FolderPlus size={16} />}
              Open Folder
            </button>
          </div>
        </header>

        <div className="grid flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
          <aside className="border-b border-black/10 bg-[#fdfcf8] p-4 lg:border-b-0 lg:border-r">
            <section className="space-y-5">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-black/45">
                  <FolderOpen size={14} />
                  Project
                </div>
                <h2 className="break-words text-lg font-semibold">{projectName}</h2>
                <p className="mt-1 text-sm text-black/55">
                  {files.length
                    ? `${files.length} files, ${(stats.totalSize / 1024).toFixed(1)} KB indexed`
                    : "Open a local folder to build the code context."}
                </p>
                <p className="mt-2 truncate font-mono text-[11px] text-black/35" title={sessionId}>
                  Session {sessionId === "session-pending" ? "loading" : compactSessionId(sessionId)}
                </p>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase text-black/45">
                    <History size={14} />
                    Sessions
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshSessions(projectName)}
                    disabled={projectName === "No project loaded" || isLoadingSessions}
                    className="text-xs font-medium text-[#1f6f5f] disabled:text-black/25"
                  >
                    {isLoadingSessions ? "Syncing" : "Refresh"}
                  </button>
                </div>
                <div className="max-h-52 overflow-auto rounded-md border border-black/10 bg-white py-1 text-sm">
                  {sessions.length ? (
                    sessions.map((session) => {
                      const active = session.sessionId === sessionId;
                      return (
                        <button
                          key={session.sessionId}
                          type="button"
                          onClick={() =>
                            void loadSessionHistory(session.sessionId, session.projectPath).catch((sessionError) => {
                              setError(sessionError instanceof Error ? sessionError.message : "Could not load session.");
                            })
                          }
                          className={`block w-full px-3 py-2 text-left transition ${
                            active ? "bg-[#dfeee8]" : "hover:bg-black/[0.04]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-semibold">{compactSessionId(session.sessionId)}</span>
                            <span className="shrink-0 text-[11px] text-black/40">
                              {session.messageCount} msg · {session.traceCount} track
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-4 text-black/50">{sessionPreview(session)}</p>
                        </button>
                      );
                    })
                  ) : (
                    <p className="px-3 py-2 text-sm text-black/50">
                      {projectName === "No project loaded" ? "Open a project to view sessions." : "No saved sessions yet."}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-black/10 bg-white p-3">
                  <p className="text-xs text-black/45">Files</p>
                  <p className="mt-1 text-2xl font-semibold">{files.length}</p>
                </div>
                <div className="rounded-md border border-black/10 bg-white p-3">
                  <p className="text-xs text-black/45">Context cap</p>
                  <p className="mt-1 text-2xl font-semibold">90k</p>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-black/45">
                  <Code2 size={14} />
                  Languages
                </div>
                <div className="space-y-2">
                  {stats.languages.length ? (
                    stats.languages.map(([language, count]) => (
                      <div key={language} className="flex items-center justify-between text-sm">
                        <span>{language}</span>
                        <span className="text-black/45">{count}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-black/50">No indexed files yet.</p>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-black/45">
                  <FileCode2 size={14} />
                  Explorer
                </div>
                <div className="max-h-[42vh] overflow-auto rounded-md border border-black/10 bg-white py-1 text-sm">
                  {fileTree.length ? (
                    fileTree.map((node) => (
                      <FileTreeRow
                        key={node.path}
                        node={node}
                        depth={0}
                        expandedPaths={expandedPaths}
                        onToggle={toggleDirectory}
                      />
                    ))
                  ) : (
                    <p className="px-3 py-2 text-sm text-black/50">No local folder opened.</p>
                  )}
                </div>
              </div>
            </section>
          </aside>

          <section className="relative flex min-h-[620px] flex-col bg-[#fbfaf6]">
            <div className="border-b border-black/10 px-4 py-4 md:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium uppercase text-black/45">
                    <Sparkles size={14} />
                    Code Assistant
                  </div>
                  <h2 className="mt-1 text-xl font-semibold">Ask against the selected codebase</h2>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2 text-xs text-black/55">
                  <Search size={14} />
                  {files.length ? "Context ranking active" : "Waiting for import"}
                </div>
              </div>
            </div>

            <StepRail steps={steps} activeStepId={activeStepId} onFocusStep={focusStep} />

            <div ref={chatScrollRef} className="flex-1 overflow-auto px-4 py-5 md:px-6">
              <div className="mx-auto flex max-w-4xl flex-col gap-4 xl:pr-16">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    id={`message-${message.id}`}
                    className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {message.role === "assistant" && (
                      <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-md bg-[#1f6f5f] text-white">
                        <Bot size={16} />
                      </div>
                    )}
                    <div
                      className={`max-w-[820px] rounded-md border px-4 py-3 text-sm leading-6 ${
                        message.role === "user"
                          ? "border-[#1f6f5f]/20 bg-[#dfeee8]"
                          : "border-black/10 bg-white"
                      }`}
                    >
                      {message.role === "assistant" ? (
                        message.content ? (
                          <div className="markstream-scope">
                            <MarkdownRender content={message.content} final={Boolean(message.done)} fade={false} />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-black/55">
                            <Loader2 className="animate-spin" size={15} />
                            Thinking through the selected files
                          </div>
                        )
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                  </article>
                ))}
                <div ref={chatEndRef} className="h-px" />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="border-t border-black/10 bg-[#fdfcf8] p-4 md:p-5">
              <div className="mx-auto flex max-w-4xl flex-col gap-3">
                {error && (
                  <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <CircleAlert size={15} />
                    {error}
                  </div>
                )}
                <div className="flex gap-2">
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="Ask about architecture, a file, a bug, or what to change next..."
                    className="min-h-20 flex-1 resize-none rounded-md border border-black/10 bg-white px-3 py-3 text-sm outline-none transition placeholder:text-black/35 focus:border-[#1f6f5f] focus:ring-3 focus:ring-[#1f6f5f]/15"
                  />
                  <button
                    type="submit"
                    disabled={!question.trim() || isAnswering}
                    className="flex w-12 shrink-0 items-center justify-center rounded-md bg-[#191919] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-black/25"
                    aria-label="Run question"
                    title="Run question"
                  >
                    {isAnswering ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
                  </button>
                </div>
              </div>
            </form>
          </section>

          <aside className="border-t border-black/10 bg-[#fdfcf8] p-4 lg:border-l lg:border-t-0">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium uppercase text-black/45">
                  <Workflow size={14} />
                  Trace
                </div>
                <h2 className="mt-1 text-lg font-semibold">Tool calls</h2>
              </div>
              <TerminalSquare className="text-black/45" size={18} />
            </div>

            <div className="space-y-3">
              {trace.map((item) => (
                <div key={item.id} className="rounded-md border border-black/10 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-semibold">{item.name}</p>
                      <p className="mt-1 text-xs leading-5 text-black/55">{item.detail}</p>
                    </div>
                    <TraceStatus status={item.status} />
                  </div>
                  <p className="mt-2 text-[11px] text-black/35">{item.time}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function StepRail({
  steps,
  activeStepId,
  onFocusStep,
}: {
  steps: ConversationStep[];
  activeStepId: ConversationStep["id"] | null;
  onFocusStep: (step: ConversationStep) => void;
}) {
  if (!steps.length) return null;

  return (
    <nav
      aria-label="Conversation steps"
      className="group/steps absolute bottom-32 right-3 top-28 z-20 hidden w-24 lg:block"
    >
      <div className="relative h-full w-full" aria-hidden>
        {steps.map((step, index) => {
          const active = step.id === activeStepId;
          const top = steps.length === 1 ? 50 : 8 + (index / (steps.length - 1)) * 84;
          const statusClass =
            step.status === "error"
              ? "bg-red-500"
              : step.status === "running"
                ? "animate-pulse bg-[#1f6f5f]"
                : active
                  ? "bg-[#1f6f5f]"
                  : "bg-black/30";

          return (
            <div
              key={step.id}
              className="absolute right-2 flex h-5 w-16 -translate-y-1/2 items-center justify-end"
              style={{ top: `${top}%` }}
            >
              <span
                className={`block h-0.5 rounded-full transition-all duration-150 ${
                  active ? "w-9" : "w-6 group-hover/steps:w-10"
                } ${statusClass}`}
              />
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute right-20 top-1/2 hidden w-80 -translate-y-1/2 rounded-lg border border-black/10 bg-white py-2 text-sm shadow-lg group-hover/steps:block group-hover/steps:pointer-events-auto">
        <div className="max-h-[46vh] overflow-auto">
          {steps.map((step) => {
            const active = step.id === activeStepId;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => onFocusStep(step)}
                className={`block w-full truncate px-4 py-2 text-left transition ${
                  active ? "bg-black/[0.04] font-medium" : "hover:bg-black/[0.035]"
                }`}
                title={step.title}
              >
                {stepLabel(step)}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function FileTreeRow({
  node,
  depth,
  expandedPaths,
  onToggle,
}: {
  node: FileTreeNode;
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isDirectory = node.type === "directory";
  const isExpanded = expandedPaths.has(node.path);

  return (
    <div>
      <button
        type="button"
        onClick={() => isDirectory && onToggle(node.path)}
        className="flex h-7 w-full items-center gap-1.5 px-2 text-left transition hover:bg-black/[0.05]"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={node.path}
      >
        {isDirectory ? (
          isExpanded ? (
            <ChevronDown className="shrink-0 text-black/45" size={14} />
          ) : (
            <ChevronRight className="shrink-0 text-black/45" size={14} />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isDirectory ? (
          <FolderOpen className="shrink-0 text-[#1f6f5f]" size={15} />
        ) : (
          <FileText className="shrink-0 text-black/45" size={15} />
        )}
        <span className="truncate">{node.name}</span>
        {!isDirectory && node.file?.language && <span className="ml-auto shrink-0 text-[10px] text-black/35">{node.file.language}</span>}
      </button>
      {isDirectory && isExpanded
        ? node.children.map((child) => (
            <FileTreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
            />
          ))
        : null}
    </div>
  );
}

function TraceStatus({ status }: { status: TraceEvent["status"] }) {
  if (status === "running") return <Loader2 className="shrink-0 animate-spin text-[#1f6f5f]" size={16} />;
  if (status === "done") return <CheckCircle2 className="shrink-0 text-[#1f6f5f]" size={16} />;
  if (status === "error") return <CircleAlert className="shrink-0 text-red-600" size={16} />;
  return <div className="size-2 shrink-0 rounded-full bg-black/25" />;
}
