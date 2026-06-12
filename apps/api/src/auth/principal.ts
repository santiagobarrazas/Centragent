// A resolved caller. Every authenticated request acts as a User, optionally
// impersonating one Agent the user owns. The agent is the RFC 8693 "actor";
// the owning user is the recorded "subject".
export type Principal = {
  userId: string;
  agentId: string | null;
  tokenId: string | null;
  via: "token" | "session" | "local-owner";
  scopes: string[];
  isLocalOwner: boolean;
};

export const isImpersonating = (principal: Principal) =>
  principal.agentId !== null;

/** "agent" when impersonating, otherwise "user". */
export const actorType = (principal: Principal): "user" | "agent" =>
  principal.agentId ? "agent" : "user";

/** The id of the acting entity (agent when impersonating, else user). */
export const actorId = (principal: Principal): string =>
  principal.agentId ?? principal.userId;
