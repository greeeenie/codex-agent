# Codex Hub website

The complete web application for [Codex Hub](https://agent-board-stepan.readymars.chatgpt.site). The local agent and Windows installer sources live in [`../runner/`](../runner/) and [`../windows/`](../windows/).

## Development

Node.js 22.13 or newer is required for development.

```powershell
cd site
npm run install:ci
npm run build
```

Apply the initial migration to the local preview database:

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_material_purple_man.sql
npm run dev -- --port 5173
```

Open the URL printed by the development server. Local preview simulates ChatGPT sign-in on loopback only. Local and hosted databases are separate. A clean preview has no projects until an agent synchronizes them.

```powershell
npx tsc --noEmit
```

## Source layout

| Directory | Purpose |
| --- | --- |
| `app/` | Board UI, sign-in integration, connection flow, and server routes |
| `lib/` | Task lifecycle, request validation, and shared data types |
| `db/`, `drizzle/` | D1 schema and checked-in migrations |
| `worker/` | Cloudflare Worker entry point |
| `scripts/` | Build, preview, dependency, and Sites integration helpers |
| `public/` | Static assets |
| `components/`, `hooks/`, `vendor/` | Included UI components and licensed supporting styles |

## Hosting and secrets

The app runs on Sites with Cloudflare Workers, D1 (`DB`), and R2 (`BUCKET`). `.openai/hosting.json` declares the required bindings and MCP capability. The live Site's project identity is intentionally omitted from this public source copy. Register your own Site and set its identity when deploying a separate instance.

Configure `AGENT_SITES_TOKEN` through the Site's secret settings. Do not put its value in source, build output, the installer, or GitHub. This is the dispatch-issued service token for the same private Site. Browser identity and sign-in are managed by Sites.

The application currently relies on an **owner-private Site access boundary** for its APIs. Do not expose the Worker or change its audience to public without adding the required server-side authorization.

No credentials, local databases, user tasks, dependency directories, or compiled output are included in this repository.

## Task lifecycle

**Backlog → Queued → Running → Done.** New tasks remain in Backlog until explicitly queued. Failed or interrupted work returns to Backlog with an explanation. Restoring a completed task preserves its Codex context and returns it to Backlog; it does not revert project files.

The website stores task state and screenshots. The installed local agent executes queued tasks against the selected projects. Only task execution invokes the model.
