import type { FastifyRequest } from "fastify";
import { SESSION_COOKIE } from "@centragent/shared";
import type { AppConfig } from "../config.js";
import type { Principal } from "../auth/principal.js";
import { unauthorized } from "../errors.js";
import type { AuthService } from "../services/auth-service.js";

/**
 * Resolves `request.principal` from, in order: a Bearer ApiToken, a session
 * cookie, or (when AUTH_ALLOW_LOCAL_OWNER) the local owner. A present-but-bad
 * Bearer token fails the request with 401 immediately; a bad cookie is ignored.
 */
export function createAuthPreHandler(auth: AuthService, config: AppConfig) {
  return async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (header && header.toLowerCase().startsWith("bearer ")) {
      const raw = header.slice(7).trim();
      if (raw) {
        request.principal = await auth.resolveToken(raw);
        return;
      }
    }

    const cookie = request.cookies?.[SESSION_COOKIE];
    if (cookie) {
      const principal = await auth.resolveSession(cookie);
      if (principal) {
        request.principal = principal;
        return;
      }
    }

    if (config.AUTH_ALLOW_LOCAL_OWNER) {
      request.principal = await auth.localOwnerPrincipal();
    }
  };
}

export function requirePrincipal(request: FastifyRequest): Principal {
  if (!request.principal) {
    throw unauthorized("Authentication required");
  }
  return request.principal;
}

/** A principal acting as a human (not impersonating) — for account/token ops. */
export function requireUserPrincipal(request: FastifyRequest): Principal {
  const principal = requirePrincipal(request);
  if (principal.agentId) {
    throw unauthorized("This action requires a user session, not an agent token");
  }
  return principal;
}
