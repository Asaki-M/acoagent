import type { AppRouter } from "./types.js";

export function registerHealthRoutes(app: AppRouter) {
  app.get("/health", (context) =>
    context.json({
      ok: true,
      service: "ai-platform-api",
      defaultProvider: process.env.MODEL_PROVIDER || "vertex",
    }),
  );
}
