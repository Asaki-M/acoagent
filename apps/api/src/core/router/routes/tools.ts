import type { ChatRequestBody } from "../../types/chat.js";
import { ToolNotFoundError, ToolValidationError } from "../../tools/index.js";
import { normalizeJsonObject } from "../../tools/utils/json.js";
import { normalizeScope } from "../utils/scope.js";
import type { AppRouter, RouterDependencies } from "./types.js";

export function registerToolRoutes(app: AppRouter, { toolPool }: Pick<RouterDependencies, "toolPool">) {
  app.get("/api/tools", async (context) => {
    return context.json({
      tools: toolPool.listTools(),
    });
  });

  app.post("/api/tools/search", async (context) => {
    const body = (await context.req.json()) as { query?: string; topK?: number };
    const query = body.query?.trim();

    if (!query) {
      return context.json({ message: "Query is required." }, 400);
    }

    try {
      return context.json({
        tools: await toolPool.searchTools(query, body.topK),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool search failed.";
      return context.json({ message }, 503);
    }
  });

  app.post("/api/tools/call", async (context) => {
    const body = (await context.req.json()) as ChatRequestBody & {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    const name = body.name?.trim();

    if (!name) {
      return context.json({ message: "Tool name is required." }, 400);
    }

    try {
      const result = await toolPool.callTool(name, normalizeJsonObject(body.arguments), normalizeScope(body));
      return context.json(result);
    } catch (error) {
      if (error instanceof ToolNotFoundError) {
        return context.json({ message: error.message }, 404);
      }

      if (error instanceof ToolValidationError) {
        return context.json({ message: error.message }, 400);
      }

      throw error;
    }
  });
}
