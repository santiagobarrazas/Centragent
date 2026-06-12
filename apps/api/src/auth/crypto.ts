import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import {
  TOKEN_PREFIX_AGENT,
  TOKEN_PREFIX_USER,
  type TokenKind
} from "@centragent/shared";

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // 2^14

export const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const base64url = (bytes: Buffer) =>
  bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export type GeneratedSecret = {
  raw: string;
  hash: string;
  prefix: string;
};

/** Mint an opaque bearer token. The raw value is returned once; only the hash
 *  is persisted. The prefix is safe to display. */
export const generateToken = (kind: TokenKind): GeneratedSecret => {
  const tag = kind === "agent" ? TOKEN_PREFIX_AGENT : TOKEN_PREFIX_USER;
  const raw = `${tag}${base64url(randomBytes(32))}`;
  return { raw, hash: sha256(raw), prefix: `${raw.slice(0, tag.length + 6)}…` };
};

/** Random opaque secret (session ids, invite codes). */
export const generateSecret = (size = 32): GeneratedSecret => {
  const raw = base64url(randomBytes(size));
  return { raw, hash: sha256(raw), prefix: `${raw.slice(0, 6)}…` };
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return `scrypt$${SCRYPT_COST}$${salt.toString("hex")}$${derived.toString("hex")}`;
};

export const verifyPassword = async (
  password: string,
  stored: string
): Promise<boolean> => {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") {
    return false;
  }
  const cost = Number.parseInt(parts[1] ?? "", 10);
  const salt = Buffer.from(parts[2] ?? "", "hex");
  const expected = Buffer.from(parts[3] ?? "", "hex");
  if (!Number.isInteger(cost) || salt.length === 0 || expected.length === 0) {
    return false;
  }
  const derived = scryptSync(password, salt, expected.length, { N: cost });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
};
