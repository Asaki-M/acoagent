import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { defaultDatabasePath } from "../memory/utils/store-helpers.js";

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

export type WorkflowNodeRecord = {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data: {
    title: string;
    kind: string;
    description: string;
    accent?: string;
    config?: {
      executeLogic?: string;
      condition?: string;
      task?: string;
      outputSchema?: string;
      mapEntries?: Array<{
        id: string;
        key: string;
        source: "data" | "input" | "step" | "value";
        path: string;
        value: string;
        stepId: string;
      }>;
      mapJson?: string;
      sideEffect?: string;
      branches?: Array<{
        id: string;
        name: string;
        condition: string;
        step: string;
      }>;
      branchesJson?: string;
      parallelSteps?: Array<{
        id: string;
        name: string;
        execute: string;
      }>;
      parallelStepsJson?: string;
      maxIterations?: number;
      loopBody?: string;
    };
  };
};

export type WorkflowEdgeRecord = {
  id: string;
  source: string;
  target: string;
  type?: string;
};

export type PersistedWorkflow = {
  id: string;
  name: string;
  nodes: WorkflowNodeRecord[];
  edges: WorkflowEdgeRecord[];
  nextNodeIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowInput = {
  id?: string;
  name?: string;
  nodes?: WorkflowNodeRecord[];
  edges?: WorkflowEdgeRecord[];
  nextNodeIndex?: number;
};

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as SqliteModule;

export class WorkflowStore {
  private readonly db: DatabaseSync;

  constructor(path = defaultDatabasePath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  listWorkflows() {
    return this.db
      .prepare(
        `
        SELECT
          id,
          name,
          nodes_json AS nodesJson,
          edges_json AS edgesJson,
          next_node_index AS nextNodeIndex,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM workflows
        ORDER BY updated_at DESC, created_at DESC
      `,
      )
      .all()
      .map((row) => this.inflate(row as WorkflowRow));
  }

  getWorkflow(id: string) {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          name,
          nodes_json AS nodesJson,
          edges_json AS edgesJson,
          next_node_index AS nextNodeIndex,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM workflows
        WHERE id = ?
      `,
      )
      .get(id) as WorkflowRow | undefined;

    return row ? this.inflate(row) : undefined;
  }

  createWorkflow(input: WorkflowInput) {
    const id = input.id || `workflow-${Date.now()}`;
    const name = cleanName(input.name, "Untitled workflow");
    const nodes = input.nodes ?? [];
    const edges = input.edges ?? [];
    const nextNodeIndex = input.nextNodeIndex ?? Math.max(nodes.length + 1, 1);

    this.db
      .prepare(
        `
        INSERT INTO workflows (
          id,
          name,
          nodes_json,
          edges_json,
          next_node_index,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `,
      )
      .run(id, name, JSON.stringify(nodes), JSON.stringify(edges), nextNodeIndex);

    const workflow = this.getWorkflow(id);
    if (!workflow) throw new Error("Workflow was not created.");
    return workflow;
  }

  updateWorkflow(id: string, input: WorkflowInput) {
    const current = this.getWorkflow(id);
    if (!current) return undefined;

    const name = cleanName(input.name, current.name);
    const nodes = input.nodes ?? current.nodes;
    const edges = input.edges ?? current.edges;
    const nextNodeIndex = input.nextNodeIndex ?? current.nextNodeIndex;

    this.db
      .prepare(
        `
        UPDATE workflows
        SET
          name = ?,
          nodes_json = ?,
          edges_json = ?,
          next_node_index = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `,
      )
      .run(name, JSON.stringify(nodes), JSON.stringify(edges), nextNodeIndex, id);

    return this.getWorkflow(id);
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        nodes_json TEXT NOT NULL DEFAULT '[]',
        edges_json TEXT NOT NULL DEFAULT '[]',
        next_node_index INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  private inflate(row: WorkflowRow): PersistedWorkflow {
    return {
      id: row.id,
      name: row.name,
      nodes: parseJsonArray<WorkflowNodeRecord>(row.nodesJson),
      edges: parseJsonArray<WorkflowEdgeRecord>(row.edgesJson),
      nextNodeIndex: row.nextNodeIndex,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

type WorkflowRow = {
  id: string;
  name: string;
  nodesJson: string;
  edgesJson: string;
  nextNodeIndex: number;
  createdAt: string;
  updatedAt: string;
};

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function cleanName(value: string | undefined, fallback: string) {
  const name = value?.replace(/\s+/g, " ").trim();
  return name || fallback;
}
