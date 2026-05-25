"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Circle,
  Clock3,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Users,
  X
} from "lucide-react";
import {
  apiClient,
  type AgentMembership,
  type Conversation,
  type JoinRequest,
  type Message,
  type RealtimeEnvelope,
  type SearchResult,
  wsUrl
} from "@/lib/api";

const formatTime = (value: string | null) => {
  if (!value) {
    return "No messages";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
};

const shortId = (id: string | null) => (id ? id.slice(0, 8) : "none");

const secondsLeft = (expiresAt: string, now: number) =>
  Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<AgentMembership[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [embeddingConfigured, setEmbeddingConfigured] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const socketRef = useRef<WebSocket | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId),
    [conversations, selectedId]
  );

  const loadConversations = useCallback(async () => {
    const response = await apiClient.listConversations();
    setConversations(response.conversations);
    setSelectedId((current) => current ?? response.conversations[0]?.id ?? null);
  }, []);

  const loadPendingJoinRequests = useCallback(async () => {
    const response = await apiClient.listPendingJoinRequests();
    setJoinRequests(response.joinRequests);
  }, []);

  const loadConversationDetails = useCallback(async (conversationId: string) => {
    const [messageResponse, agentResponse] = await Promise.all([
      apiClient.listMessages(conversationId),
      apiClient.listAgents(conversationId)
    ]);
    setMessages(messageResponse.messages);
    setAgents(agentResponse.agents);
  }, []);

  useEffect(() => {
    void Promise.all([loadConversations(), loadPendingJoinRequests()]).catch(
      (caught: Error) => setError(caught.message)
    );
  }, [loadConversations, loadPendingJoinRequests]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setAgents([]);
      return;
    }

    void loadConversationDetails(selectedId).catch((caught: Error) =>
      setError(caught.message)
    );
    socketRef.current?.send(
      JSON.stringify({ type: "subscribe", conversationId: selectedId })
    );
  }, [loadConversationDetails, selectedId]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const socket = new WebSocket(wsUrl());
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (selectedId) {
        socket.send(JSON.stringify({ type: "subscribe", conversationId: selectedId }));
      }
    });

    socket.addEventListener("message", (event) => {
      const envelope = JSON.parse(event.data) as RealtimeEnvelope;

      if (envelope.event === "conversation.created" || envelope.event === "conversation.updated") {
        void loadConversations();
      }

      if (envelope.event === "message.created") {
        const incoming = envelope.payload as Message;
        setMessages((current) => {
          if (incoming.conversationId !== selectedId) {
            return current;
          }
          if (current.some((message) => message.id === incoming.id)) {
            return current;
          }
          return [...current, incoming].sort(
            (left, right) => left.sequenceNumber - right.sequenceNumber
          );
        });
      }

      if (envelope.event.startsWith("agent.join_request.")) {
        void loadPendingJoinRequests();
      }

      if (
        envelope.event === "agent.joined" &&
        selectedId &&
        envelope.conversationId === selectedId
      ) {
        void apiClient.listAgents(selectedId).then((response) =>
          setAgents(response.agents)
        );
      }
    });

    socket.addEventListener("error", () => {
      setError("Realtime connection failed. The API may not be running.");
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [loadConversations, loadPendingJoinRequests, selectedId]);

  const createConversation = async () => {
    const title = newTitle.trim();
    if (!title) {
      return;
    }

    try {
      const response = await apiClient.createConversation(title);
      setNewTitle("");
      await loadConversations();
      setSelectedId(response.conversation.id);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || !selectedId) {
      return;
    }

    try {
      setDraft("");
      await apiClient.sendMessage(selectedId, content);
    } catch (caught) {
      setDraft(content);
      setError((caught as Error).message);
    }
  };

  const accept = async (request: JoinRequest) => {
    try {
      await apiClient.acceptJoinRequest(request.id);
      await Promise.all([
        loadPendingJoinRequests(),
        selectedId ? loadConversationDetails(selectedId) : Promise.resolve()
      ]);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const reject = async (request: JoinRequest) => {
    const reason = window.prompt("Reason for rejection (optional)") ?? undefined;
    try {
      await apiClient.rejectJoinRequest(request.id, reason);
      await loadPendingJoinRequests();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const search = async () => {
    const query = searchQuery.trim();
    if (!query || !selectedId) {
      return;
    }

    try {
      const response = await apiClient.semanticSearch(selectedId, query);
      setSearchResults(response.results);
      setEmbeddingConfigured(response.embeddingConfigured);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  return (
    <main className="workspace">
      <aside className="rail">
        <div className="brand">
          <div className="mark">C</div>
          <div>
            <h1>Centragent</h1>
            <p>Local agent conversations</p>
          </div>
        </div>

        <form
          className="create-row"
          onSubmit={(event) => {
            event.preventDefault();
            void createConversation();
          }}
        >
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="New conversation"
          />
          <button type="submit" title="Create conversation" aria-label="Create conversation">
            <Plus size={18} />
          </button>
        </form>

        <div className="conversation-list">
          {conversations.map((conversation) => (
            <button
              className={`conversation-item ${
                conversation.id === selectedId ? "active" : ""
              }`}
              key={conversation.id}
              onClick={() => setSelectedId(conversation.id)}
            >
              <span>{conversation.title}</span>
              <small>
                {formatTime(conversation.lastMessageAt)} · {conversation.agentCount} agents
              </small>
            </button>
          ))}
        </div>
      </aside>

      <section className="timeline">
        <header className="topbar">
          <div>
            <h2>{selectedConversation?.title ?? "Create a conversation"}</h2>
            <p>{selectedConversation ? selectedConversation.id : "No conversation selected"}</p>
          </div>
          <div className="status-pill">
            <Circle size={10} fill="currentColor" />
            Local MVP
          </div>
        </header>

        {error ? (
          <div className="error-banner">
            <ShieldAlert size={18} />
            <span>{error}</span>
            <button onClick={() => setError(null)} title="Dismiss" aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        ) : null}

        <div className="messages">
          {messages.map((message) => (
            <article
              className={`message ${message.senderType}`}
              key={message.id}
            >
              <div className="message-meta">
                <span>
                  {message.senderType === "agent"
                    ? `Agent ${shortId(message.senderId)}`
                    : "Master user"}
                </span>
                <span>#{message.sequenceNumber}</span>
                <span>{formatTime(message.createdAt)}</span>
              </div>
              <p>{message.content}</p>
            </article>
          ))}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <textarea
            value={draft}
            disabled={!selectedId}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message as master user"
            rows={3}
          />
          <button type="submit" disabled={!selectedId || !draft.trim()} title="Send message">
            <Send size={18} />
            Send
          </button>
        </form>
      </section>

      <aside className="side">
        <section className="panel">
          <div className="panel-heading">
            <Users size={18} />
            <h3>Agents</h3>
          </div>
          <div className="agent-list">
            {agents.length === 0 ? <p className="muted">No connected agents</p> : null}
            {agents.map((membership) => (
              <div className="agent-row" key={membership.id}>
                <div>
                  <strong>{membership.agent.name}</strong>
                  <span>{membership.agent.provider} · {membership.role}</span>
                </div>
                <em>{membership.status}</em>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <Clock3 size={18} />
            <h3>Join Requests</h3>
          </div>
          <div className="request-list">
            {joinRequests.length === 0 ? <p className="muted">No pending requests</p> : null}
            {joinRequests.map((request) => (
              <div className="request-card" key={request.id}>
                <div className="request-main">
                  <strong>{request.agent.name}</strong>
                  <span>{request.agent.provider} · {request.requestedRole}</span>
                  <span>{request.conversation.title}</span>
                  {request.reason ? <p>{request.reason}</p> : null}
                </div>
                <div className="countdown">
                  {secondsLeft(request.expiresAt, now)}s
                </div>
                <div className="actions">
                  <button
                    className="accept"
                    onClick={() => void accept(request)}
                    title="Accept join request"
                    aria-label="Accept join request"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    className="reject"
                    onClick={() => void reject(request)}
                    title="Reject join request"
                    aria-label="Reject join request"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel search-panel">
          <div className="panel-heading">
            <Search size={18} />
            <h3>Semantic Search</h3>
          </div>
          <form
            className="search-row"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search conversation"
              disabled={!selectedId}
            />
            <button type="submit" disabled={!selectedId || !searchQuery.trim()} title="Search">
              <Search size={16} />
            </button>
          </form>
          {!embeddingConfigured ? (
            <p className="muted">Embeddings are not configured.</p>
          ) : null}
          <div className="results">
            {searchResults.map((result) => (
              <article className="result-card" key={result.pointId}>
                <div>
                  <strong>{result.score.toFixed(3)}</strong>
                  <span>message {shortId(result.messageId)}</span>
                  <span>agent {shortId(result.agentId)}</span>
                </div>
                <p>{result.content}</p>
              </article>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}
