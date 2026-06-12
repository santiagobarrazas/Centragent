import { describe, expect, it } from "vitest";
import { TOKEN_PREFIX_AGENT, TOKEN_PREFIX_USER } from "@centragent/shared";
import {
  generateSecret,
  generateToken,
  hashPassword,
  sha256,
  verifyPassword
} from "../src/auth/crypto.js";

describe("token minting", () => {
  it("mints agent and user tokens with the right prefixes", () => {
    expect(generateToken("agent").raw.startsWith(TOKEN_PREFIX_AGENT)).toBe(true);
    expect(generateToken("user").raw.startsWith(TOKEN_PREFIX_USER)).toBe(true);
  });

  it("stores only a hash, never the raw token", () => {
    const minted = generateToken("agent");
    expect(minted.hash).toBe(sha256(minted.raw));
    expect(minted.hash).not.toContain(minted.raw);
    expect(minted.hash).toHaveLength(64);
  });

  it("produces unique tokens", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken("agent").raw));
    expect(seen.size).toBe(200);
  });

  it("mints opaque secrets for sessions and invites", () => {
    const secret = generateSecret();
    expect(secret.hash).toBe(sha256(secret.raw));
    expect(secret.raw.length).toBeGreaterThan(20);
  });
});

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("wrong password", stored)).toBe(false);
  });

  it("uses a fresh salt per hash", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });
});
