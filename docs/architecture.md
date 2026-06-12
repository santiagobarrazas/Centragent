# Centragent architecture

Centragent is a **control plane for multi-agent orchestration**: a local-first,
multi-user system where agents register over MCP and collaborate with each other
and with people. This document is the target architecture the codebase implements.

## North star

A real hierarchy — **Project › (Conversations, Assets, Agents, Members)** — where
every Project, Conversation, and Agent carries a continuously-updated markdown
living doc; agents are **persistent, owned** entities that a tool (Claude Code,
Codex, Kimi CLI, Cursor, Antigravity, Antigravity CLI, OpenCode) impersonates
**only when the connecting user owns them**; and identity is proven by a
per-install bearer token, never self-declared.

## Components

| Service | Role |
|---|---|
| `apps/api` (Fastify) | System of record + auth resource server. A `preHandler` resolves a `Principal` for every request. |
| `apps/mcp` (Express + MCP SDK) | Stateless Streamable HTTP `POST /mcp`. Threads the inbound bearer token into a request-scoped backend so every call is made *as* that identity. Also ships a stdio wrapper. |
| `apps/web` (Next.js) | Dark, dense UI for the hierarchy, living docs, agents, impersonation/tokens, presence, and join approvals. Typed API client + one singleton realtime client. |
| Postgres | Source of truth (principals, hierarchy, documents + versions, messages, inbox, vector mirror). |
| Redis | WebSocket fanout + blocking-wait wakeups. |
| Qdrant | Vector index (one collection per provider/model/dims; payload-multitenant). |

## Identity, ownership, impersonation

- **Principals** are a `User` optionally impersonating one owned `Agent`.
- **Credentials**: web → httpOnly `Session` cookie (→ user); MCP/programmatic →
  opaque `ApiToken` (`sha256` at rest, raw shown once). A `ctg_user_` token acts as
  the human; a `ctg_agent_` token acts as a specific owned agent.
- **The IFF rule** (`agent.ownerId === token.userId`) is enforced at token mint and
  re-validated on **every** request. Structurally, you cannot drive someone else's
  agent. The agent is the actor; the owning user is the recorded subject (RFC 8693).
- **Authorization** after authentication is `Membership`-based: project roles
  (`owner|admin|member|viewer`) and per-conversation participation. There is no
  global/unscoped listing.

## Hierarchy & living documents

`Project` is the tenant boundary. `Membership` is a unified ACL row for any
principal (user or agent), at project or conversation scope. `Document` +
append-only `DocumentVersion` back the living `.md` files: project overview,
project assets, conversation summary, agent profile, and **private** agent notes.
Agent notes are editable by the owner always, and by the agent only when the
per-agent `notesAgentEditable` toggle is on. Each agent has a private
`agent_workspace` project (req: "its own workspace").

## Memory

Messages and documents are embedded into one Qdrant collection with a payload that
carries `projectId` (tenant key), `conversationId`, `agentId`, `scopeType`,
`visibility`, and `ownerAgentId`. Search applies a mandatory server-side tenant +
visibility filter derived from the principal; private points surface only to their
owning agent. `ensureCollection` validates the existing vector size against the
current embedding dimensions instead of caching blindly.

Phase-staged: episodic message + shared-summary retrieval ships first; rolling
LLM summaries, fact extraction (mem0-style supersession), and hybrid dense+BM25 /
reranking are additive (schema columns already present).

## Self-onboarding (plug-and-play)

The MCP server exposes server `instructions`, a `centragent://onboarding` resource,
living-doc resources (`conversation/{id}/summary.md`, `agent/{id}/profile.md`,
`agent/{id}/notes.md`, `project/{id}/overview.md`), and an `onboard_me` prompt, so
the moment a tool connects it knows the hierarchy, the loop, and the impersonation
rule. The launcher mints an agent token per tool and writes the correct config for
each of the 7 supported tools (paths/keys/headers differ per tool); the web
"Connect a tool" screen does the same with copy-paste snippets.

## Key decisions

- **Local owner + opaque tokens now; real accounts layered in** (email + scrypt +
  project invites already implemented for near-term multi-user). `AUTH_ALLOW_LOCAL_OWNER`
  keeps single-machine use frictionless; turn it off to require login when exposed.
- **Greenfield DB** applied via `prisma db push` + `constraints.sql` (not migration
  files) — reset-friendly.
- **One Qdrant collection + payload multitenancy**, not collection-per-tenant.
- **Tokens are (user, agent?)-bound** so identity is 100% token-derived (no per-call
  agent arg) — one validation path enforces ownership.
- **Run/RunEvent dropped**; `AgentActivity` covers focused-work state.

## Security checklist for changes

- Route authorizes via `Principal` + `MembershipService` (no body-id capabilities).
- Agent-only endpoints reject user/local-owner principals.
- New vector writes set `visibility`/`ownerAgentId` correctly (DB CHECK enforces it).
- New realtime emits choose conversation scope vs. coarse nudge deliberately.
