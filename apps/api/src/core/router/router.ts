import { Hono } from "hono";
import { cors } from "hono/cors";
import { MemoryStore } from "../memory/store.js";
import { ModelHarness } from "../service/harness/model.js";
import { createDefaultTools, ToolPool } from "../tools/index.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerToolRoutes } from "./routes/tools.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";

const harness = ModelHarness.fromEnv();
const memoryStore = new MemoryStore();
const toolPool = new ToolPool();
toolPool.registerMany(createDefaultTools(memoryStore));

// 创建 Hono API 应用，集中配置中间件和挂载按能力拆分的路由模块。
export function createApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => {
        const configuredOrigins = (process.env.WEB_ORIGIN || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        const allowedOrigins = new Set([
          ...configuredOrigins,
          "http://localhost:3000",
          "http://localhost:3001",
        ]);

        if (allowedOrigins.has(origin)) return origin;
        return configuredOrigins[0] || origin || "*";
      },
      allowHeaders: ["Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  const dependencies = {
    harness,
    memoryStore,
    toolPool,
  };

  registerHealthRoutes(app);
  registerSessionRoutes(app, dependencies);
  registerToolRoutes(app, dependencies);
  registerWorkflowRoutes(app);
  registerChatRoutes(app, dependencies);

  return app;
}
