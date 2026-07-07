import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import type { ModelMessage } from "../service/harness/types.js";
import type { TraceStatus } from "../types/chat.js";
import { defaultDatabasePath, truncateTitle } from "./utils/store-helpers.js";

type DatabaseSync = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  };
};

type SqliteModule = {
  DatabaseSync: new (path: string) => DatabaseSync;
};

// 记忆读写的作用域：同一个项目下的不同会话彼此隔离。
export type MemoryScope = {
  projectName: string;
  projectPath: string;
  sessionId: string;
};

// 持久化的对话消息，用于历史记录和短期记忆窗口。
export type ConversationMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

// 一条会话执行轨迹，用于前端展示请求、模型、工具等步骤状态。
export type SessionTrace = {
  id: string;
  name: string;
  status: TraceStatus;
  detail: string;
  time: string;
  createdAt: string;
};

// 会话列表页使用的摘要信息。
export type SessionSummary = {
  projectPath: string;
  sessionId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  traceCount: number;
  lastMessage: string | null;
};

// 一次用户提问到助手回答的执行步骤。
export type ConversationStep = {
  id: number;
  title: string;
  status: "running" | "done" | "error";
  userMessageId: number;
  assistantMessageId: number | null;
  createdAt: string;
  updatedAt: string;
};

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as SqliteModule;

// SQLite 记忆仓库：统一维护会话、消息、步骤、轨迹和工作记忆。
export class MemoryStore {
  private readonly db: DatabaseSync;

  constructor(path = defaultDatabasePath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  // 确保当前项目会话存在，不存在就创建，存在则刷新项目名和更新时间。
  ensureSession(scope: MemoryScope) {
    this.db
      .prepare(
        `
        INSERT INTO sessions (project_path, session_id, project_name, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(project_path, session_id)
        DO UPDATE SET project_name = excluded.project_name, updated_at = datetime('now')
      `,
      )
      .run(scope.projectPath, scope.sessionId, scope.projectName);
  }

  // 追加一条用户或助手消息，并返回消息 id。
  addMessage(scope: MemoryScope, role: ConversationMessage["role"], content: string) {
    this.ensureSession(scope);
    const result = this.db
      .prepare(
        `
        INSERT INTO messages (project_path, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `,
      )
      .run(scope.projectPath, scope.sessionId, role, content);
    this.touchSession(scope);
    return Number(result.lastInsertRowid);
  }

  // 读取最近 N 条消息作为短期记忆滑动窗口，返回时恢复为时间正序。
  getShortTermMessages(scope: MemoryScope, limit = 5): ModelMessage[] {
    const rows = this.db
      .prepare(
        `
        SELECT role, content
        FROM messages
        WHERE project_path = ? AND session_id = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      )
      .all(scope.projectPath, scope.sessionId, limit) as Array<{ role: "user" | "assistant"; content: string }>;

    return rows.reverse().map((row) => ({
      role: row.role,
      content: row.content,
    }));
  }

  // 读取会话历史消息，主要给历史接口和前端回放使用。
  getMessages(scope: MemoryScope, limit = 100): ConversationMessage[] {
    const rows = this.db
      .prepare(
        `
        SELECT id, role, content, created_at AS createdAt
        FROM messages
        WHERE project_path = ? AND session_id = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      )
      .all(scope.projectPath, scope.sessionId, limit) as ConversationMessage[];

    return rows.reverse();
  }

  // 创建一次问答步骤，先标记为 running，完成或失败后再更新状态。
  createStep(scope: MemoryScope, userMessageId: number, title: string) {
    this.ensureSession(scope);
    const result = this.db
      .prepare(
        `
        INSERT INTO conversation_steps (
          project_path,
          session_id,
          title,
          status,
          user_message_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 'running', ?, datetime('now'), datetime('now'))
      `,
      )
      .run(scope.projectPath, scope.sessionId, truncateTitle(title), userMessageId);
    this.touchSession(scope);
    return Number(result.lastInsertRowid);
  }

  // 将步骤标记为完成，并关联助手回复消息。
  completeStep(scope: MemoryScope, stepId: number, assistantMessageId: number) {
    this.db
      .prepare(
        `
        UPDATE conversation_steps
        SET status = 'done', assistant_message_id = ?, updated_at = datetime('now')
        WHERE id = ? AND project_path = ? AND session_id = ?
      `,
      )
      .run(assistantMessageId, stepId, scope.projectPath, scope.sessionId);
    this.touchSession(scope);
  }

  // 将步骤标记为失败，便于前端展示异常状态。
  failStep(scope: MemoryScope, stepId: number) {
    this.db
      .prepare(
        `
        UPDATE conversation_steps
        SET status = 'error', updated_at = datetime('now')
        WHERE id = ? AND project_path = ? AND session_id = ?
      `,
      )
      .run(stepId, scope.projectPath, scope.sessionId);
    this.touchSession(scope);
  }

  // 读取当前会话的步骤列表。
  getSteps(scope: MemoryScope, limit = 100): ConversationStep[] {
    return this.db
      .prepare(
        `
        SELECT
          id,
          title,
          status,
          user_message_id AS userMessageId,
          assistant_message_id AS assistantMessageId,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM conversation_steps
        WHERE project_path = ? AND session_id = ?
        ORDER BY id ASC
        LIMIT ?
      `,
      )
      .all(scope.projectPath, scope.sessionId, limit) as ConversationStep[];
  }

  // 读取当前会话的工作记忆；没有记录时返回空字符串。
  getWorkMemory(scope: MemoryScope) {
    const row = this.db
      .prepare(
        `
        SELECT content
        FROM work_memories
        WHERE project_path = ? AND session_id = ?
      `,
      )
      .get(scope.projectPath, scope.sessionId) as { content: string } | undefined;

    return row?.content ?? "";
  }

  // 覆盖写入工作记忆，适合模型维护阶段提交整理后的完整内容。
  updateWorkMemory(scope: MemoryScope, content: string) {
    this.ensureSession(scope);
    this.db
      .prepare(
        `
        INSERT INTO work_memories (project_path, session_id, content, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(project_path, session_id)
        DO UPDATE SET content = excluded.content, updated_at = datetime('now')
      `,
      )
      .run(scope.projectPath, scope.sessionId, content.trim());
    this.touchSession(scope);
  }

  // 清空当前会话的工作记忆。
  clearWorkMemory(scope: MemoryScope) {
    this.db
      .prepare(
        `
        DELETE FROM work_memories
        WHERE project_path = ? AND session_id = ?
      `,
      )
      .run(scope.projectPath, scope.sessionId);
    this.touchSession(scope);
  }

  // 记录一条执行轨迹，同时刷新会话更新时间。
  addTrace(scope: MemoryScope, trace: Omit<SessionTrace, "createdAt">) {
    this.ensureSession(scope);
    this.db
      .prepare(
        `
        INSERT INTO session_traces (id, project_path, session_id, name, status, detail, time, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
      )
      .run(trace.id, scope.projectPath, scope.sessionId, trace.name, trace.status, trace.detail, trace.time);
    this.touchSession(scope);
  }

  // 读取当前会话的执行轨迹，返回时恢复为时间正序。
  getTraces(scope: MemoryScope, limit = 100): SessionTrace[] {
    const rows = this.db
      .prepare(
        `
        SELECT id, name, status, detail, time, created_at AS createdAt
        FROM session_traces
        WHERE project_path = ? AND session_id = ?
        ORDER BY rowid DESC
        LIMIT ?
      `,
      )
      .all(scope.projectPath, scope.sessionId, limit) as SessionTrace[];

    return rows.reverse();
  }

  // 列出会话摘要；传入 projectPath 时只返回该项目下的会话。
  listSessions(projectPath?: string): SessionSummary[] {
    const sql = projectPath
      ? `
        SELECT
          sessions.project_path AS projectPath,
          sessions.session_id AS sessionId,
          sessions.project_name AS projectName,
          sessions.created_at AS createdAt,
          sessions.updated_at AS updatedAt,
          COUNT(DISTINCT messages.id) AS messageCount,
          COUNT(DISTINCT session_traces.id) AS traceCount,
          (
            SELECT content
            FROM messages last_messages
            WHERE last_messages.project_path = sessions.project_path
              AND last_messages.session_id = sessions.session_id
            ORDER BY last_messages.id DESC
            LIMIT 1
          ) AS lastMessage
        FROM sessions
        LEFT JOIN messages
          ON messages.project_path = sessions.project_path
          AND messages.session_id = sessions.session_id
        LEFT JOIN session_traces
          ON session_traces.project_path = sessions.project_path
          AND session_traces.session_id = sessions.session_id
        WHERE sessions.project_path = ?
        GROUP BY sessions.project_path, sessions.session_id
        ORDER BY sessions.updated_at DESC
      `
      : `
        SELECT
          sessions.project_path AS projectPath,
          sessions.session_id AS sessionId,
          sessions.project_name AS projectName,
          sessions.created_at AS createdAt,
          sessions.updated_at AS updatedAt,
          COUNT(DISTINCT messages.id) AS messageCount,
          COUNT(DISTINCT session_traces.id) AS traceCount,
          (
            SELECT content
            FROM messages last_messages
            WHERE last_messages.project_path = sessions.project_path
              AND last_messages.session_id = sessions.session_id
            ORDER BY last_messages.id DESC
            LIMIT 1
          ) AS lastMessage
        FROM sessions
        LEFT JOIN messages
          ON messages.project_path = sessions.project_path
          AND messages.session_id = sessions.session_id
        LEFT JOIN session_traces
          ON session_traces.project_path = sessions.project_path
          AND session_traces.session_id = sessions.session_id
        GROUP BY sessions.project_path, sessions.session_id
        ORDER BY sessions.updated_at DESC
      `;

    return projectPath
      ? (this.db.prepare(sql).all(projectPath) as SessionSummary[])
      : (this.db.prepare(sql).all() as SessionSummary[]);
  }

  // 刷新会话更新时间，用于会话列表排序。
  private touchSession(scope: MemoryScope) {
    this.db
      .prepare(
        `
        UPDATE sessions
        SET updated_at = datetime('now')
        WHERE project_path = ? AND session_id = ?
      `,
      )
      .run(scope.projectPath, scope.sessionId);
  }

  // 初始化或补齐 SQLite 表结构和索引。
  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        project_path TEXT NOT NULL,
        session_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_path, session_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_path TEXT NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_path, session_id)
          REFERENCES sessions(project_path, session_id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_scope_created
        ON messages(project_path, session_id, id);

      CREATE TABLE IF NOT EXISTS work_memories (
        project_path TEXT NOT NULL,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_path, session_id),
        FOREIGN KEY (project_path, session_id)
          REFERENCES sessions(project_path, session_id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS session_traces (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'error')),
        detail TEXT NOT NULL,
        time TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_path, session_id)
          REFERENCES sessions(project_path, session_id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_traces_scope_created
        ON session_traces(project_path, session_id, created_at);

      CREATE TABLE IF NOT EXISTS conversation_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_path TEXT NOT NULL,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'done', 'error')),
        user_message_id INTEGER NOT NULL,
        assistant_message_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_path, session_id)
          REFERENCES sessions(project_path, session_id)
          ON DELETE CASCADE,
        FOREIGN KEY (user_message_id)
          REFERENCES messages(id)
          ON DELETE CASCADE,
        FOREIGN KEY (assistant_message_id)
          REFERENCES messages(id)
          ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_steps_scope_created
        ON conversation_steps(project_path, session_id, id);
    `);
  }
}
