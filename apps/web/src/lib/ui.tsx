"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

const PROVIDER_LABELS: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  kimi_cli: "Kimi CLI",
  cursor: "Cursor",
  antigravity: "Antigravity",
  antigravity_cli: "Antigravity CLI",
  gemini_cli: "Gemini CLI",
  opencode: "OpenCode",
  custom: "Custom"
};

export const providerLabel = (provider: string) => PROVIDER_LABELS[provider] ?? provider;

const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export const colorFor = (seed: string) => {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

export function Avatar({
  name,
  color,
  size = 26
}: {
  name: string;
  color?: string | null | undefined;
  size?: number;
}) {
  return (
    <span
      className="avatar"
      style={{ background: color ?? colorFor(name), width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials(name)}
    </span>
  );
}

export const formatTime = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
};

export const secondsLeft = (expiresAt: string, now: number) =>
  Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));

export function Markdown({ children }: { children: string }) {
  return (
    <div className="doc">
      <ReactMarkdown>{children || "_Empty._"}</ReactMarkdown>
    </div>
  );
}

/** Tiny data hook: fetch on mount/deps change, expose reload for realtime nudges. */
export function useData<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    fn()
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => reload(), [reload]);

  return { data, error, loading, reload, setData };
}
