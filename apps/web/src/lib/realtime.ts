"use client";

import { useEffect } from "react";
import { wsUrl, type RealtimeEnvelope } from "./api";

type Listener = (envelope: RealtimeEnvelope) => void;

// One WebSocket for the whole app. Components attach listeners and subscribe to
// conversations; selecting a conversation never tears down the socket.
class RealtimeClient {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly subscriptions = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private ensure() {
    if (typeof window === "undefined" || this.socket) {
      return;
    }
    const socket = new WebSocket(wsUrl());
    this.socket = socket;

    socket.addEventListener("open", () => {
      for (const conversationId of this.subscriptions) {
        socket.send(JSON.stringify({ type: "subscribe", conversationId }));
      }
    });
    socket.addEventListener("message", (event) => {
      let envelope: RealtimeEnvelope;
      try {
        envelope = JSON.parse(event.data) as RealtimeEnvelope;
      } catch {
        return;
      }
      for (const listener of this.listeners) {
        listener(envelope);
      }
    });
    socket.addEventListener("close", () => {
      this.socket = null;
      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (this.listeners.size > 0) this.ensure();
        }, 1500);
      }
    });
    socket.addEventListener("error", () => socket.close());
  }

  on(listener: Listener) {
    this.listeners.add(listener);
    this.ensure();
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribe(conversationId: string) {
    this.subscriptions.add(conversationId);
    this.ensure();
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "subscribe", conversationId }));
    }
    return () => {
      this.subscriptions.delete(conversationId);
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "unsubscribe", conversationId }));
      }
    };
  }
}

let client: RealtimeClient | null = null;
const getClient = () => (client ??= new RealtimeClient());

/** Run `handler` for every realtime event. */
export function useRealtimeEvent(handler: Listener, deps: unknown[] = []) {
  useEffect(() => getClient().on(handler), deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Subscribe to a conversation's realtime stream while mounted. */
export function useSubscribe(conversationId: string | null) {
  useEffect(() => {
    if (!conversationId) return;
    return getClient().subscribe(conversationId);
  }, [conversationId]);
}
