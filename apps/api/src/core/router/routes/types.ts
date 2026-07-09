import type { Hono } from "hono";
import type { MemoryStore } from "../../memory/store.js";
import type { ModelHarness } from "../../service/harness/model.js";
import type { ToolPool } from "../../tools/index.js";

export type AppRouter = Hono;

export type RouterDependencies = {
  harness: ModelHarness;
  memoryStore: MemoryStore;
  toolPool: ToolPool;
};
