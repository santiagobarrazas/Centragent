import { describe, expect, it } from "vitest";
import { roleAtLeast } from "../src/services/membership-service.js";
import { actorId, actorType, isImpersonating, type Principal } from "../src/auth/principal.js";

describe("project role hierarchy", () => {
  it("orders owner > admin > member > viewer", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "member")).toBe(true);
    expect(roleAtLeast("member", "viewer")).toBe(true);
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
  });

  it("denies insufficient roles", () => {
    expect(roleAtLeast("member", "admin")).toBe(false);
    expect(roleAtLeast("viewer", "member")).toBe(false);
    expect(roleAtLeast("admin", "owner")).toBe(false);
  });

  it("denies unknown roles", () => {
    expect(roleAtLeast("nonsense", "viewer")).toBe(false);
  });
});

const userPrincipal: Principal = {
  userId: "u1",
  agentId: null,
  tokenId: null,
  via: "session",
  scopes: [],
  isLocalOwner: false
};

const agentPrincipal: Principal = {
  ...userPrincipal,
  agentId: "a1",
  via: "token"
};

describe("principal actor resolution", () => {
  it("treats a non-impersonating principal as the user", () => {
    expect(actorType(userPrincipal)).toBe("user");
    expect(actorId(userPrincipal)).toBe("u1");
    expect(isImpersonating(userPrincipal)).toBe(false);
  });

  it("treats an impersonating principal as the agent (RFC 8693 actor)", () => {
    expect(actorType(agentPrincipal)).toBe("agent");
    expect(actorId(agentPrincipal)).toBe("a1");
    expect(isImpersonating(agentPrincipal)).toBe(true);
  });
});
