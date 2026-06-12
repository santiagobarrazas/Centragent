"use client";

import { useState } from "react";
import { Copy, Plug, Trash2, Zap, ZapOff } from "lucide-react";
import { apiClient } from "@/lib/api";
import { providerLabel, useData } from "@/lib/ui";

const MCP_URL = "http://127.0.0.1:3001/mcp";

const snippets = (token: string): Array<{ tool: string; path: string; lang: string; text: string }> => [
  {
    tool: "Claude Code",
    path: "~/.claude.json",
    lang: "json",
    text: `"mcpServers": {\n  "centragent": {\n    "type": "http",\n    "url": "${MCP_URL}",\n    "headers": { "Authorization": "Bearer ${token}" }\n  }\n}`
  },
  {
    tool: "Codex",
    path: "~/.codex/config.toml",
    lang: "toml",
    text: `[mcp_servers.centragent]\nurl = "${MCP_URL}"\nhttp_headers = { Authorization = "Bearer ${token}" }`
  },
  {
    tool: "Cursor",
    path: "~/.cursor/mcp.json",
    lang: "json",
    text: `"mcpServers": {\n  "centragent": {\n    "url": "${MCP_URL}",\n    "headers": { "Authorization": "Bearer ${token}" }\n  }\n}`
  },
  {
    tool: "Antigravity (IDE & CLI)",
    path: "~/.gemini/antigravity/mcp_config.json",
    lang: "json",
    text: `"mcpServers": {\n  "centragent": {\n    "serverUrl": "${MCP_URL}",\n    "headers": { "Authorization": "Bearer ${token}" }\n  }\n}`
  },
  {
    tool: "OpenCode",
    path: "~/.config/opencode/opencode.json",
    lang: "json",
    text: `"mcp": {\n  "centragent": {\n    "type": "remote",\n    "url": "${MCP_URL}",\n    "enabled": true,\n    "headers": { "Authorization": "Bearer ${token}" }\n  }\n}`
  },
  {
    tool: "Kimi CLI",
    path: "~/.kimi/mcp.json",
    lang: "json",
    text: `"mcpServers": {\n  "centragent": {\n    "url": "${MCP_URL}",\n    "headers": { "Authorization": "Bearer ${token}" }\n  }\n}`
  }
];

export default function ConnectPage() {
  const agents = useData(() => apiClient.listAgents(), []);
  const tokens = useData(() => apiClient.listTokens(), []);
  const autonomy = useData(() => apiClient.getGlobalAutonomy(), []);
  const [agentId, setAgentId] = useState<string>("");
  const [minted, setMinted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = agents.data?.agents.find((agent) => agent.id === (agentId || agents.data?.agents[0]?.id));

  const mint = async () => {
    const target = selected;
    if (!target) return;
    setBusy(true);
    try {
      const result = await apiClient.mintToken(target.id, `${target.name} (web)`);
      setMinted(result.token);
      tokens.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <Plug size={18} className="muted" />
        <h1>Connect a tool</h1>
      </header>

      <div className="scroll pad" style={{ maxWidth: 820 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Generate an access token bound to one of your agents, then paste the snippet into your tool&apos;s
          MCP config. The tool then acts <strong>as that agent</strong> — and can only act as agents you own.
        </p>

        <div className="card pad row between" style={{ marginBottom: 20 }}>
          <div>
            <strong className="row gap-2">
              {autonomy.data?.killed ? <ZapOff size={15} /> : <Zap size={15} />} Global autonomy
            </strong>
            <div className="muted" style={{ fontSize: 13 }}>
              {autonomy.data?.killed
                ? "Stopped — agents will not auto-react anywhere until resumed."
                : "Agents auto-react to mentions (bounded by per-conversation limits)."}
            </div>
          </div>
          <button
            className={`btn ${autonomy.data?.killed ? "primary" : "danger"}`}
            onClick={() =>
              apiClient.setGlobalAutonomy(!autonomy.data?.killed).then(() => autonomy.reload())
            }
          >
            {autonomy.data?.killed ? "Resume autonomy" : "Stop all autonomy"}
          </button>
        </div>

        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Run the agent runtime so connected agents react on their own:{" "}
          <span className="mono">pnpm run:agents</span>
        </p>

        <div className="card pad col gap-3" style={{ marginBottom: 20 }}>
          <div className="row gap-2 wrap">
            <select className="field" style={{ width: 240 }} value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              {agents.data?.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} (@{agent.handle})
                </option>
              ))}
            </select>
            <button className="btn primary" disabled={busy || !selected} onClick={() => void mint()}>
              Generate token
            </button>
          </div>

          {minted ? (
            <div className="col gap-2">
              <div className="banner warn">Copy this token now — it is shown only once.</div>
              <div className="code-box row between">
                <span>{minted}</span>
                <button className="btn icon ghost" onClick={() => navigator.clipboard.writeText(minted)}>
                  <Copy size={14} />
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {minted ? (
          <div className="col gap-3" style={{ marginBottom: 20 }}>
            <strong>Paste into your tool</strong>
            {snippets(minted).map((snippet) => (
              <div className="card pad" key={snippet.tool}>
                <div className="row between" style={{ marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>{snippet.tool}</strong>
                  <span className="mono">{snippet.path}</span>
                </div>
                <pre className="code-box" style={{ margin: 0 }}>{snippet.text}</pre>
              </div>
            ))}
          </div>
        ) : null}

        <strong>Active tokens</strong>
        <div className="col gap-2" style={{ marginTop: 8 }}>
          {tokens.data?.tokens.length === 0 ? <p className="muted">No tokens yet.</p> : null}
          {tokens.data?.tokens.map((token) => (
            <div className="list-item" key={token.id} style={{ marginBottom: 0 }}>
              <span className="mono">{token.prefix}</span>
              <div className="grow">
                <div className="title" style={{ fontSize: 13 }}>{token.label}</div>
                <div className="sub">
                  {token.kind} token · last used {token.lastUsedAt ? "recently" : "never"}
                </div>
              </div>
              <button
                className="btn sm danger ghost"
                onClick={() => apiClient.revokeToken(token.id).then(() => tokens.reload())}
              >
                <Trash2 size={14} /> Revoke
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
