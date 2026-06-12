"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search, Send } from "lucide-react";
import {
  apiClient,
  type Message,
  type Participant,
  type SearchResult
} from "@/lib/api";
import { DocEditor } from "@/components/DocEditor";
import { useRealtimeEvent, useSubscribe } from "@/lib/realtime";
import { Avatar, formatTime, providerLabel, useData } from "@/lib/ui";

type SideTab = "participants" | "summary" | "search";

export default function ConversationPage({
  params
}: {
  params: Promise<{ projectId: string; conversationId: string }>;
}) {
  const { projectId, conversationId } = use(params);
  const conversation = useData(() => apiClient.getConversation(conversationId), [conversationId]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [draft, setDraft] = useState("");
  const [side, setSide] = useState<SideTab>("participants");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [embeddingsOn, setEmbeddingsOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const mergeMessage = useCallback((incoming: Message) => {
    setMessages((current) => {
      if (current.some((message) => message.id === incoming.id)) return current;
      return [...current, incoming].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    });
  }, []);

  const loadParticipants = useCallback(() => {
    apiClient
      .listParticipants(conversationId)
      .then((response) => setParticipants(response.participants))
      .catch(() => {});
  }, [conversationId]);

  useEffect(() => {
    apiClient
      .listMessages(conversationId)
      .then((response) => setMessages(response.messages))
      .catch((caught: Error) => setError(caught.message));
    loadParticipants();
  }, [conversationId, loadParticipants]);

  useSubscribe(conversationId);

  useRealtimeEvent(
    (envelope) => {
      if (envelope.conversationId && envelope.conversationId !== conversationId) return;
      if (envelope.event === "message.created") {
        mergeMessage(envelope.payload as Message);
      } else if (
        envelope.event === "agent.presence.updated" ||
        envelope.event === "agent.joined" ||
        envelope.event === "agent.activity.started" ||
        envelope.event === "agent.activity.finished"
      ) {
        loadParticipants();
      }
    },
    [conversationId]
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    try {
      const response = await apiClient.sendMessage(conversationId, content);
      mergeMessage(response.message);
    } catch (caught) {
      setDraft(content);
      setError((caught as Error).message);
    }
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    const response = await apiClient.search(conversationId, query.trim());
    setResults(response.results);
    setEmbeddingsOn(response.embeddingConfigured);
  };

  return (
    <>
      <header className="topbar">
        <Link href={`/p/${projectId}`} className="btn icon ghost"><ArrowLeft size={16} /></Link>
        <h1>{conversation.data?.conversation.title ?? "…"}</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {participants.length} participant{participants.length === 1 ? "" : "s"}
        </span>
      </header>

      {error ? <div className="pad" style={{ paddingBottom: 0 }}><div className="banner error">{error}</div></div> : null}

      <div className="conv">
        <div className="timeline">
          <div className="messages">
            {messages.map((message) => {
              const isAgent = message.sender?.type === "agent";
              const name =
                message.sender?.type === "agent"
                  ? message.sender.name
                  : message.sender?.type === "user"
                    ? message.sender.name
                    : "Unknown";
              const color = message.sender?.type === "user" ? message.sender.avatarColor : undefined;
              return (
                <article key={message.id} className={`msg ${isAgent ? "agent" : "user"}`}>
                  <Avatar name={name} color={color} size={28} />
                  <div className="body">
                    <div className="meta">
                      <span className="name">{name}</span>
                      {message.sender?.type === "agent" ? (
                        <span className="handle">@{message.sender.handle}</span>
                      ) : null}
                      <span className="time">{formatTime(message.createdAt)}</span>
                    </div>
                    <div className="content">{message.content}</div>
                  </div>
                </article>
              );
            })}
            <div ref={endRef} />
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              className="field"
              rows={2}
              placeholder="Message as yourself. Mention agents with @handle."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn primary" type="submit" disabled={!draft.trim()}>
              <Send size={16} /> Send
            </button>
          </form>
        </div>

        <aside className="side-pane">
          <div className="side-tabs">
            {(["participants", "summary", "search"] as SideTab[]).map((value) => (
              <button key={value} className={`tab ${side === value ? "active" : ""}`} onClick={() => setSide(value)}>
                {value[0]!.toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <div className="side-body">
            {side === "participants" ? (
              participants.length === 0 ? (
                <p className="muted">No participants yet. Agents appear here after they join.</p>
              ) : (
                participants.map((participant) => {
                  const presence = participant.agent?.presences[0];
                  const name = participant.user?.name ?? participant.agent?.name ?? "?";
                  return (
                    <div className="participant" key={participant.id}>
                      <Avatar name={name} color={participant.user?.avatarColor} size={28} />
                      <div className="info">
                        <div className="name">
                          {participant.agent ? (
                            <Link href={`/a/${participant.agent.id}`}>{name}</Link>
                          ) : (
                            name
                          )}
                        </div>
                        <div className="status">
                          {participant.agent
                            ? `${providerLabel(participant.agent.provider)}${presence?.activityTitle ? ` · ${presence.activityTitle}` : ""}`
                            : "you / member"}
                        </div>
                      </div>
                      {participant.agent ? (
                        <span className={`dot ${presence?.status ?? "offline"}`} />
                      ) : null}
                    </div>
                  );
                })
              )
            ) : null}

            {side === "summary" ? (
              <DocEditor documentId={conversation.data?.conversation.summaryDocumentId ?? null} canEdit />
            ) : null}

            {side === "search" ? (
              <div className="col gap-2">
                <form
                  className="row gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runSearch();
                  }}
                >
                  <input
                    className="field"
                    placeholder="Search this conversation"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <button className="btn icon" type="submit"><Search size={15} /></button>
                </form>
                {!embeddingsOn ? <p className="muted">Embeddings are not configured.</p> : null}
                {results.map((result) => (
                  <div className="card pad" key={result.pointId} style={{ fontSize: 13 }}>
                    <div className="row between muted" style={{ fontSize: 11, marginBottom: 4 }}>
                      <span>{result.scopeType}</span>
                      <span className="mono">{result.score.toFixed(3)}</span>
                    </div>
                    <div>{result.content.slice(0, 240)}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </>
  );
}
