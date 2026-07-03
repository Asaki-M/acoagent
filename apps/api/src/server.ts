import { serve } from "@hono/node-server";
import { config } from "dotenv";

for (const path of ["../../.env.local", "../../.env", ".env.local", ".env"]) {
  config({ path, override: false, quiet: true });
}

const { createApp } = await import("./app/router.js");

const port = Number(process.env.API_PORT || 8787);
const app = createApp();

const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`API server listening on http://localhost:${info.port}`);
  },
);

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`API port ${port} is already in use. Stop the old process or set API_PORT in .env.local.`);
    process.exit(1);
  }

  throw error;
});
