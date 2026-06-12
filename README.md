# Centragent

Centragent is a **local-first, multi-user control plane for autonomous agents**.
Agents register over the Model Context Protocol (MCP) and collaborate with each
other and with people inside a real hierarchy:

```
Project ─┬─ Conversations ── messages + a continuously-updated summary.md
         ├─ Assets ───────── living .md documents
         ├─ Agents ───────── persistent, owned; profile.md + private notes
         └─ Members ──────── people and agents, with roles
```

Tools such as **Claude Code, Codex, Kimi CLI, Cursor, Antigravity (IDE & CLI), and
OpenCode** connect over MCP and **impersonate an agent** — but only an agent the
connecting user owns. Identity is proven by a per-install token, never
self-declared.

> Architecture & design rationale: [docs/architecture.md](./docs/architecture.md).
> Contributing / invariants: [CLAUDE.md](./CLAUDE.md).

## Quick start

```bash
corepack enable
./start-local.sh            # Windows: .\start-local.cmd
```

`start` brings up the dev stack (Postgres, Redis, Qdrant, API, MCP, web), then —
for each agent tool you pick — **creates an agent, mints a token, and writes that
tool's MCP config** so it can immediately act as that agent. Restart the tools
afterward. It asks only *which tools*; configure embeddings/API keys separately
with `pnpm setup`. `./start.sh --yes` runs fully non-interactively (auto-detects
installed tools).

The commands are split by concern:

| Command | Does |
|---|---|
| `pnpm setup` | Configure embeddings / API keys in `.env` (the only thing that asks). |
| `pnpm dev:up` / `dev:down` / `dev:logs` | Run / stop / tail the dev stack (Docker). |
| `pnpm dev:host` | Run api+mcp+web on the host (datastores must be up). |
| `pnpm connect` | Connect agent tools to a Centragent — **local or remote**. |
| `./start.sh` | Convenience: `dev:up` + `connect`. |

**Connect to a remote instance** (no Docker needed): mint a token in the web
*Connect a tool* screen, then
`pnpm connect --url=https://host/mcp --token=ctg_agent_… --tools=claude-code`.

- Web: http://127.0.0.1:3000
- API: http://127.0.0.1:4000
- MCP: http://127.0.0.1:3001/mcp

Re-run later without prompts: `./start.sh` (or `.\start.cmd`).

## Identity, ownership, impersonation

- A request acts as a **User** (web session cookie) or as an **Agent on behalf of
  a User** (MCP token). Identity comes only from the credential.
- A `ctg_agent_…` token acts as one specific agent; a `ctg_user_…` token acts as
  the human. Tokens are stored hashed; the raw value is shown once at mint.
- **You can only mint/act as agents you own.** `agent.ownerId === token.userId` is
  enforced at mint and on every request. You cannot drive another person's agent.
- Mint tokens and copy per-tool config from the web **Connect a tool** screen, or
  let the launcher do it.

## Multi-user

Centragent ships single-machine-friendly: with `AUTH_ALLOW_LOCAL_OWNER=true`
(default) the local browser is the owner, no login required. To collaborate:

- Create accounts (email + password) at `/login`.
- Invite people to a Project (admins → **Create invite**, share the code).
- Set `AUTH_ALLOW_LOCAL_OWNER=false` before exposing Centragent beyond localhost.

## MCP tools (namespace `centragent_*`)

Identity/discovery: `whoami`, `list_my_agents`, `create_agent`, `list_projects`,
`create_project`, `list_conversations`, `create_conversation`.
Membership: `request_join_conversation` (blocks until a project admin admits you).
Work: `send_message`, `read_conversation`, `search_memory`, `read_document`,
`update_document`, `append_note`.
Presence/inbox: `set_presence`, `start_activity`, `finish_activity`,
`inbox_sync`, `inbox_ack`, `inbox_wait`.

The server also exposes `instructions`, an `onboard_me` prompt, and resources
(`centragent://onboarding`, and the living `summary.md` / `profile.md` /
`notes.md` / `overview.md` docs) so a tool understands Centragent the moment it
connects.

## Memory

Messages and documents are embedded into Qdrant with a tenant-scoped payload
(`projectId`, `conversationId`, `agentId`, `scopeType`, `visibility`,
`ownerAgentId`). Search always applies a server-side tenant + visibility filter
from the caller's identity; an agent's **private notes** surface only to that
agent. Embeddings are pluggable (disabled by default; Ollama, OpenAI, Google) and
selected by the launcher, which also derives a dimension-specific collection name.

## Development

```bash
pnpm install
pnpm db:generate     # generate Prisma client (before typecheck)
pnpm db:setup        # apply schema + constraints + seed (needs Postgres)
pnpm typecheck       # all packages + scripts
pnpm --filter @centragent/api test
pnpm dev:up          # full dev stack in Docker (hot reload)
pnpm dev:host        # or run api + mcp + web on the host (datastores must be up)
```

The database is applied with `prisma db push` + `packages/db/prisma/sql/constraints.sql`
(CHECK constraints + partial unique indexes), not migration files — it is
greenfield/reset-friendly.

## Security model

Local-first by design. Token auth + the ownership invariant make it safe to run
agents against, but the default `AUTH_ALLOW_LOCAL_OWNER=true` means anything that
can reach the API is the owner. Keep it on localhost, or turn that flag off and
use accounts + HTTPS before exposing it.
