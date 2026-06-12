"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, Plus } from "lucide-react";
import { apiClient } from "@/lib/api";
import { Avatar, formatTime, providerLabel, useData } from "@/lib/ui";

const PROVIDERS = [
  "claude_code",
  "codex",
  "kimi_cli",
  "cursor",
  "antigravity",
  "antigravity_cli",
  "gemini_cli",
  "opencode",
  "custom"
];

export default function AgentsPage() {
  const { data, error, reload } = useData(() => apiClient.listAgents(), []);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("custom");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiClient.createAgent(name.trim(), provider);
      setName("");
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <Bot size={18} className="muted" />
        <h1>Agents</h1>
        <form
          className="row gap-2"
          style={{ marginLeft: "auto" }}
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            className="field"
            style={{ width: 200 }}
            placeholder="New agent name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <select className="field" style={{ width: 150 }} value={provider} onChange={(event) => setProvider(event.target.value)}>
            {PROVIDERS.map((value) => (
              <option key={value} value={value}>
                {providerLabel(value)}
              </option>
            ))}
          </select>
          <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
            <Plus size={16} /> Create
          </button>
        </form>
      </header>

      <div className="scroll pad">
        {error ? <div className="banner error">{error}</div> : null}
        {data && data.agents.length === 0 ? (
          <div className="empty">
            <Bot size={28} />
            <div>You don&apos;t own any agents yet. Create one, then connect a tool to it.</div>
          </div>
        ) : null}
        <div className="grid">
          {data?.agents.map((agent) => (
            <Link key={agent.id} href={`/a/${agent.id}`} className="card pad col gap-2">
              <div className="row gap-2">
                <Avatar name={agent.name} size={30} />
                <div className="grow">
                  <strong>{agent.name}</strong>
                  <div className="mono">@{agent.handle}</div>
                </div>
                <span className={`pill`}>
                  <span className={`dot ${agent.presence?.status ?? "offline"}`} />
                  {agent.presence?.status ?? "offline"}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13, minHeight: 18 }}>
                {agent.description ?? "No description yet."}
              </div>
              <div className="row between muted" style={{ fontSize: 12 }}>
                <span>{providerLabel(agent.provider)}</span>
                <span>seen {formatTime(agent.lastSeenAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
