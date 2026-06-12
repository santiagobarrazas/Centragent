# Centragent — agent & contributor guide

Centragent is a **local-first, multi-user control plane for autonomous agents**.
Agents register over MCP and collaborate with each other and with people inside a
hierarchy of **Projects → Conversations / Documents / Members**. Each Project,
Conversation, and Agent carries a continuously-updated markdown "living doc".

This file is the operating manual for anyone (human or agent) working **on** the
Centragent codebase. For how an agent **uses** Centragent at runtime, read the
MCP server `instructions` and the `centragent://onboarding` resource.

## Monorepo layout

```
apps/api      Fastify API + WebSocket — system of record & OAuth resource server
apps/mcp      MCP Streamable HTTP server (stateless) — thin proxy onto the API
apps/web      Next.js App Router UI (dark, TanStack-free typed client + WS)
packages/db   Prisma schema + client + seed (Postgres)
packages/shared  Zod schemas, enums/constants, realtime event vocab, embedding registry
scripts/start-local.ts  Interactive launcher: configures .env, mints tokens, installs MCP into tools
```

Postgres is the source of truth. Redis is WebSocket fanout + blocking-wait
wakeups. Qdrant holds vectors only.

## Core invariants (do not break)

1. **Identity is never self-declared.** Every request resolves a `Principal`
   (`apps/api/src/auth/principal.ts`) from a Bearer `ApiToken` (MCP/programmatic)
   or a session cookie (web). MCP tool args carry **no** identity.
2. **Impersonation IFF ownership.** A token with `agentId` set may act as that
   agent only while `agent.ownerId === token.userId`. Enforced at **mint** and on
   **every request** (`AuthService.resolveToken`). The agent is the actor; the
   owning user is the subject (RFC 8693).
3. **Membership-scoped reads.** No endpoint lists across tenants. Agents see only
   conversations they joined; users see conversations in their projects. The WS
   `/ws` is authenticated and conversation subscriptions are membership-gated.
4. **Private-note isolation.** `agent_notes` documents and their vector points are
   `visibility=private` + `ownerAgentId` set, surfaced only to the owning agent /
   its owner. Enforced in code AND by DB CHECK constraints (`constraints.sql`).
5. **Token-bound vector search.** `QdrantMemoryService.search` always applies a
   server-side tenant + visibility filter built from the principal — never from
   agent free input.

When you add a route, it must `requirePrincipal(request)` and authorize via
`MembershipService` (project role or conversation membership). Never trust an id
in the body as a capability.

## Commands

```bash
pnpm install              # install deps
pnpm db:generate          # generate Prisma client (needed before typecheck)
pnpm db:setup             # db push + apply constraints.sql + seed  (needs Postgres)
pnpm typecheck            # tsc across all packages + scripts
pnpm --filter @centragent/api test   # vitest unit tests (e2e gated on CENTRAGENT_E2E_URL)
pnpm dev                  # run api + mcp + web (needs datastores up)
pnpm start:local          # interactive launcher (full Docker stack + tool install)
pnpm compose:up           # docker compose up --build -d
```

The DB is applied with `prisma db push` + `prisma/sql/constraints.sql` (the
CHECK constraints and partial unique indexes Prisma can't express), **not**
migration files — it is greenfield/reset-friendly. After editing the schema run
`pnpm db:generate` then `pnpm db:setup`.

## Conventions

- TypeScript is strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
  Optional fields that receive Zod `.optional()` outputs are typed `?: T | undefined`.
- ESM throughout: imports use explicit `.js` specifiers (vitest resolves these via
  `extensionAlias`).
- Validation lives in `packages/shared` Zod schemas; routes parse, services trust
  parsed input + the `Principal`.
- Realtime event names live in `packages/shared/src/events.ts`; conversation-scoped
  events fan out to subscribers, coarse events nudge all authenticated clients.
- The MCP server (`apps/mcp/src/server.ts`) is a thin mapping of `centragent_*`
  tools onto the same REST routes the web uses, carrying the caller's token.

## Auth/runtime config

`AUTH_ALLOW_LOCAL_OWNER=true` (default) treats unauthenticated requests as the
local owner — frictionless for single-machine use. Set it `false` before exposing
Centragent beyond localhost; real accounts (email + scrypt) and project invites
already exist for multi-user.
