import { describe, expect, it } from "vitest";

// End-to-end auth checks against a RUNNING Centragent API. Skipped unless
// CENTRAGENT_E2E_URL is set (e.g. http://127.0.0.1:4000). Run the stack first:
//   pnpm db:setup && pnpm api:dev   (with Postgres/Redis/Qdrant up)
//   CENTRAGENT_E2E_URL=http://127.0.0.1:4000 pnpm --filter @centragent/api test
const BASE = process.env.CENTRAGENT_E2E_URL;

describe.skipIf(!BASE)("auth boundaries (e2e)", () => {
  const url = (path: string) => `${BASE}${path}`;

  it("rejects an invalid bearer token with 401", async () => {
    const response = await fetch(url("/projects"), {
      headers: { authorization: "Bearer ctg_agent_not-a-real-token" }
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("refuses agent-only endpoints without an agent token", async () => {
    // With no credentials the caller is at most the local owner (a user), which
    // is not allowed to use agent-only messaging endpoints.
    const response = await fetch(url("/agent/messages"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "00000000-0000-4000-8000-000000000000", content: "x" })
    });
    expect([400, 401, 403]).toContain(response.status);
  });

  it("serves health without auth", async () => {
    const response = await fetch(url("/health"));
    expect(response.ok).toBe(true);
  });
});
