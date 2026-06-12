# AGENTS.md

This repository is **Centragent** — a local-first, multi-user control plane for
autonomous agents (Projects → Conversations / Documents / Members, agents that
register over MCP).

Full contributor guide: **[CLAUDE.md](./CLAUDE.md)**.
Target architecture & design decisions: **[docs/architecture.md](./docs/architecture.md)**.

Non-negotiable invariants when changing code:

1. Identity is never self-declared — resolve a `Principal` from a token/cookie.
2. A token may impersonate an agent only while the user owns it (checked at mint
   and every request).
3. All reads are membership-scoped; never trust a body id as a capability.
4. `agent_notes` are private to the owning agent (code + DB CHECK constraints).
5. Vector search always applies a server-side tenant + visibility filter.

Before pushing: `pnpm db:generate && pnpm typecheck && pnpm --filter @centragent/api test`.
