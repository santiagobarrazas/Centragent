const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

export const wsUrl = () => process.env.NEXT_PUBLIC_WS_URL ?? "ws://127.0.0.1:4000/ws";

// --- types ------------------------------------------------------------------

export type Whoami = {
  user: { id: string; name: string; email: string | null; isLocalOwner: boolean } | null;
  actorType: "user" | "agent";
  impersonating: { id: string; name: string; handle: string; provider: string } | null;
  via: string;
  ownedAgents: Array<{ id: string; name: string; handle: string; provider: string }>;
};

export type Project = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  conversationCount?: number;
  memberCount?: number;
  overviewDocumentId?: string | null;
};

export type Conversation = {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  participantCount?: number;
  summaryDocumentId?: string | null;
};

export type MessageSender =
  | { type: "agent"; id: string; name: string; handle: string; provider: string }
  | { type: "user"; id: string; name: string; avatarColor: string | null }
  | null;

export type Message = {
  id: string;
  conversationId: string;
  senderType: string;
  role: string;
  status: string;
  content: string;
  sequenceNumber: number;
  createdAt: string;
  sender: MessageSender;
};

export type Presence = {
  status: string;
  statusMessage: string | null;
  activityTitle: string | null;
  lastSeenAt: string;
} | null;

export type Agent = {
  id: string;
  ownerId: string;
  name: string;
  handle: string;
  provider: string;
  description: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  notesAgentEditable?: boolean;
  presence: Presence;
  ownerName?: string;
  isOwnedByYou?: boolean;
  profileDocumentId?: string | null;
  notesDocumentId?: string | null;
  workspaceProjectId?: string | null;
};

export type Participant = {
  id: string;
  principalType: "user" | "agent";
  role: string;
  participantRole: string | null;
  user: { id: string; name: string; avatarColor: string | null } | null;
  agent: {
    id: string;
    name: string;
    handle: string;
    provider: string;
    ownerId: string;
    presences: Array<{ status: string; activityTitle: string | null }>;
  } | null;
};

export type Member = {
  id: string;
  principalType: "user" | "agent";
  role: string;
  user: { id: string; name: string; email: string | null; avatarColor: string | null } | null;
  agent: { id: string; name: string; handle: string; provider: string; ownerId: string } | null;
};

export type JoinRequest = {
  id: string;
  conversationId: string;
  requestedRole: string;
  status: string;
  reason: string | null;
  expiresAt: string;
  createdAt: string;
  agent: { id: string; name: string; handle: string; provider: string };
  conversation: { id: string; title: string; projectId: string };
};

export type DocumentResult = {
  id: string;
  kind: string;
  title: string;
  currentContent: string;
  agentEditable: boolean;
  isPrivate: boolean;
  agentId: string | null;
  projectId: string | null;
  conversationId: string | null;
  updatedAt: string;
};

export type Asset = {
  id: string;
  kind: string;
  title: string;
  slug: string | null;
  updatedAt: string;
  agentEditable: boolean;
};

export type TokenInfo = {
  id: string;
  kind: string;
  prefix: string;
  label: string;
  agentId: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type SearchResult = {
  pointId: string;
  score: number;
  content: string;
  scopeType: string;
  conversationId: string | null;
  projectId: string | null;
  agentId: string | null;
  messageId: string | null;
  documentId: string | null;
};

export type RealtimeEnvelope<TPayload = unknown> = {
  event: string;
  payload: TPayload;
  conversationId?: string | null;
  createdAt: string;
};

// --- transport --------------------------------------------------------------

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include"
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, json?.error?.message ?? `Request failed (${response.status})`);
  }
  return json as T;
}

const body = (value: unknown) => JSON.stringify(value);

export const apiClient = {
  // auth
  me: () => api<Whoami>("/auth/me"),
  login: (email: string, password: string) =>
    api<{ user: unknown }>("/auth/login", { method: "POST", body: body({ email, password }) }),
  signup: (name: string, email: string, password: string) =>
    api<{ user: unknown }>("/auth/signup", { method: "POST", body: body({ name, email, password }) }),
  logout: () => api("/auth/logout", { method: "POST", body: body({}) }),

  // projects
  listProjects: () => api<{ projects: Project[]; nextCursor: string | null }>("/projects"),
  createProject: (name: string, summary?: string) =>
    api<{ project: Project }>("/projects", { method: "POST", body: body({ name, summary }) }),
  getProject: (projectId: string) => api<{ project: Project }>(`/projects/${projectId}`),
  listProjectConversations: (projectId: string) =>
    api<{ conversations: Conversation[]; nextCursor: string | null }>(
      `/projects/${projectId}/conversations`
    ),
  listMembers: (projectId: string) => api<{ members: Member[] }>(`/projects/${projectId}/members`),
  listAssets: (projectId: string) => api<{ assets: Asset[] }>(`/projects/${projectId}/assets`),
  createAsset: (projectId: string, title: string, content: string) =>
    api<{ document: DocumentResult }>(`/projects/${projectId}/assets`, {
      method: "POST",
      body: body({ title, content })
    }),
  createInvite: (projectId: string, role: string) =>
    api<{ code: string; invite: { id: string; role: string; expiresAt: string } }>("/invites", {
      method: "POST",
      body: body({ projectId, role })
    }),

  // conversations
  createConversation: (projectId: string, title: string) =>
    api<{ conversation: Conversation }>("/conversations", {
      method: "POST",
      body: body({ projectId, title })
    }),
  getConversation: (conversationId: string) =>
    api<{ conversation: Conversation }>(`/conversations/${conversationId}`),
  listMessages: (conversationId: string) =>
    api<{ messages: Message[]; nextCursor: string | null }>(
      `/conversations/${conversationId}/messages?limit=100&direction=before`
    ),
  sendMessage: (conversationId: string, content: string) =>
    api<{ message: Message }>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: body({ content })
    }),
  listParticipants: (conversationId: string) =>
    api<{ participants: Participant[] }>(`/conversations/${conversationId}/participants`),
  addAgentToConversation: (projectId: string, conversationId: string, agentId: string) =>
    api<{ membership: unknown }>(`/projects/${projectId}/members`, {
      method: "POST",
      body: body({ agentId, conversationId, role: "member" })
    }),
  search: (conversationId: string, query: string) =>
    api<{ results: SearchResult[]; embeddingConfigured: boolean }>(
      `/conversations/${conversationId}/search`,
      { method: "POST", body: body({ query, limit: 10 }) }
    ),

  // agents
  listAgents: () => api<{ agents: Agent[] }>("/agents"),
  createAgent: (name: string, provider: string, description?: string) =>
    api<{ agent: Agent }>("/agents", { method: "POST", body: body({ name, provider, description }) }),
  getAgent: (agentId: string) => api<{ agent: Agent }>(`/agents/${agentId}`),
  updateAgent: (agentId: string, patch: Partial<{ name: string; description: string; notesAgentEditable: boolean }>) =>
    api<{ agent: Agent }>(`/agents/${agentId}`, { method: "PATCH", body: body(patch) }),

  // documents
  getDocument: (documentId: string) => api<{ document: DocumentResult }>(`/documents/${documentId}`),
  updateDocument: (documentId: string, content: string, changeSummary?: string) =>
    api<{ document: DocumentResult }>(`/documents/${documentId}`, {
      method: "PUT",
      body: body({ content, changeSummary })
    }),

  // tokens
  listTokens: () => api<{ tokens: TokenInfo[] }>("/tokens"),
  mintToken: (agentId: string, label: string) =>
    api<{ token: string; tokenInfo: TokenInfo }>("/tokens", {
      method: "POST",
      body: body({ kind: "agent", agentId, label })
    }),
  revokeToken: (tokenId: string) => api(`/tokens/${tokenId}`, { method: "DELETE" }),

  // join requests
  listJoinRequests: () => api<{ joinRequests: JoinRequest[] }>("/join-requests?status=pending"),
  acceptJoinRequest: (id: string) =>
    api(`/join-requests/${id}/accept`, { method: "POST", body: body({}) }),
  rejectJoinRequest: (id: string, reason?: string) =>
    api(`/join-requests/${id}/reject`, { method: "POST", body: body({ reason }) })
};
