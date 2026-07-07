# AI Code Platform MVP

Local code Q&A platform with a split frontend/backend architecture. The frontend imports a local project in the browser, ranks a compact code context, and streams model output plus trace events from the backend.

## Directory Structure

```text
.
├── apps
│   ├── api
│   │   ├── src
│   │   │   ├── app          # Hono routes and HTTP API composition
│   │   │   ├── harness      # Provider-neutral model input/output contract
│   │   │   ├── providers    # Vertex AI default adapter, retained OpenAI adapter, mock adapter
│   │   │   ├── transport    # SSE helpers
│   │   │   └── types        # Shared API request/trace types
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web
│       ├── src/app          # Next.js App Router UI
│       ├── public
│       ├── package.json
│       └── tsconfig.json
├── package.json             # Workspace scripts
├── pnpm-lock.yaml
└── pnpm-workspace.yaml
```

## Stack

- `apps/web`: Next.js App Router, TypeScript, Tailwind CSS v4, markstream-react
- `apps/api`: Hono, Vertex AI SDK, provider harness, SSE streaming
- `pnpm`: workspace package management

## Model Harness

The backend normalizes every code Q&A request into a provider-neutral `ModelRequest`, then streams provider output as normalized `delta`, `trace`, and `usage` events.

- Default provider: Vertex AI
- Retained provider: OpenAI, available with `MODEL_PROVIDER=openai`
- Local fallback: mock provider, used when cloud credentials are missing so the UI and trace flow remain testable

## Memory

The API persists conversation memory in SQLite. SQLite is used because this app stores local project/session history and work memory on one machine, so a single database file keeps setup light while still allowing indexed queries.

- Default database path: `apps/api/.data/memory.sqlite`
- Override path: `MEMORY_DB_PATH=/absolute/or/relative/to/apps/api/path.sqlite`
- Short-term memory: the latest 5 persisted messages for the current `projectPath + sessionId`
- Work memory: durable preferences or stable project facts maintained by model-selected built-in tools: `get_work_memory`, `update_work_memory`, and `clear_work_memory`
- Session tracks: trace events are persisted with the same `projectPath + sessionId`
- History APIs: `POST /api/sessions`, `GET /api/sessions`, and `GET /api/history?projectPath=...&sessionId=...`

The implementation uses Node's built-in `node:sqlite`, so run the API on a Node version that includes it. Current Node 22 builds may print an experimental SQLite warning.

## Tools

The backend includes a provider-neutral tools module in `apps/api/src/core/tools`.

- External services, MCP tools, and internal APIs are wrapped with `createTool({ parameters, outputSchema, execute })`.
- Tool parameters and outputs are declared with Zod and exposed as JSON Schema.
- `ToolPool` indexes tools with model embeddings and supports `searchTools(query, topK)` for nearest-tool retrieval.
- Tool routing agents can expose `createToolRoutingTools(toolPool)`, which provides internal `searchTools` and `callTool` tools.
- Tool embeddings are cached in a process-local `Map`; unchanged tool text is reused, changed or new tools are embedded on the next search, and removed tools are evicted.
- Embeddings use OpenAI (`OPENAI_API_KEY`) or Vertex (`VERTEX_AI_PROJECT`); set `TOOL_EMBEDDING_PROVIDER=openai|vertex` to force one.
- `callTool(name, arguments, context)` runs the tool `execute` function after Zod input validation, then validates the output.
- Default internal tools include platform health, memory session listing, `get_work_memory`, `update_work_memory`, and `clear_work_memory`.
- API endpoints: `GET /api/tools`, `POST /api/tools/search`, and `POST /api/tools/call`.

## Getting Started

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

The root `pnpm dev` starts both services:

- Web: `http://localhost:3000`
- API: `http://localhost:8787`

## Vertex AI Setup

Set these values in `.env.local`:

```bash
MODEL_PROVIDER=vertex
VERTEX_AI_PROJECT=your-gcp-project
VERTEX_AI_LOCATION=us-central1
VERTEX_AI_MODEL=gemini-1.5-flash
```

The Vertex SDK uses Google Application Default Credentials. For local development, authenticate your machine with Google Cloud before starting `pnpm dev:api`.

## Useful Scripts

```bash
pnpm dev
pnpm dev:web
pnpm dev:api
pnpm lint
pnpm typecheck
pnpm build
```
