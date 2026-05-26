const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  agentCount: number;
};

export type Message = {
  id: string;
  conversationId: string;
  senderType: "user" | "agent" | "system" | "tool";
  senderId: string | null;
  conversationAgentId: string | null;
  role: string;
  status: string;
  content: string;
  sequenceNumber: number;
  createdAt: string;
  metadata: Record<string, unknown>;
  sender: {
    id: string;
    name: string;
    handle: string;
    provider: string;
  } | null;
};

export type AgentMembership = {
  id: string;
  conversationId: string;
  agentId: string;
  role: string;
  status: string;
  joinedAt: string | null;
  leftAt: string | null;
  pendingEventCount: number;
  agent: {
    id: string;
    name: string;
    handle: string;
    provider: string;
    clientInstanceId: string | null;
    presence: {
      status: string;
      statusMessage: string | null;
      activityTitle: string | null;
      lastSeenAt: string;
      updatedAt: string;
    } | null;
  };
};

export type JoinRequest = {
  id: string;
  conversationId: string;
  agentId: string;
  requestedRole: string;
  status: string;
  reason: string | null;
  expiresAt: string;
  createdAt: string;
  agent: {
    id: string;
    name: string;
    handle: string;
    provider: string;
    clientInstanceId: string | null;
  };
  conversation: {
    id: string;
    title: string;
  };
};

export type SearchResult = {
  pointId: string;
  score: number;
  content: string;
  conversationId: string;
  messageId: string | null;
  agentId: string | null;
  conversationAgentId: string | null;
  metadata: Record<string, unknown>;
};

export type RealtimeEnvelope<TPayload = unknown> = {
  event: string;
  payload: TPayload;
  conversationId?: string | null;
  createdAt: string;
};

async function api<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json?.error?.message ?? `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return json as T;
}

export const wsUrl = () =>
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://127.0.0.1:4000/ws";

export const apiClient = {
  listConversations: () =>
    api<{ conversations: Conversation[]; nextCursor: string | null }>(
      "/conversations"
    ),
  createConversation: (title: string) =>
    api<{ conversation: Conversation }>("/conversations", {
      method: "POST",
      body: JSON.stringify({ title })
    }),
  listMessages: (conversationId: string) =>
    api<{ messages: Message[]; nextCursor: string | null }>(
      `/conversations/${conversationId}/messages?limit=100`
    ),
  sendMessage: (
    conversationId: string,
    content: string,
    metadata?: Record<string, unknown>
  ) =>
    api<{ message: Message }>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, metadata })
    }),
  listAgents: (conversationId: string) =>
    api<{ agents: AgentMembership[] }>(
      `/conversations/${conversationId}/agents`
    ),
  listPendingJoinRequests: () =>
    api<{ joinRequests: JoinRequest[] }>("/join-requests?status=pending"),
  acceptJoinRequest: (joinRequestId: string) =>
    api(`/join-requests/${joinRequestId}/accept`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  rejectJoinRequest: (joinRequestId: string, reason?: string) =>
    api(`/join-requests/${joinRequestId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  semanticSearch: (conversationId: string, query: string) =>
    api<{ results: SearchResult[]; embeddingConfigured: boolean }>(
      `/conversations/${conversationId}/semantic-search`,
      {
        method: "POST",
        body: JSON.stringify({ query, limit: 10 })
      }
    )
};
