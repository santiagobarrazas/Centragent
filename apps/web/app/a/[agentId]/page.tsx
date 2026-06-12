"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FolderGit2, Plug } from "lucide-react";
import { apiClient } from "@/lib/api";
import { DocEditor } from "@/components/DocEditor";
import { Avatar, formatTime, providerLabel, useData } from "@/lib/ui";

type Tab = "profile" | "notes" | "workspace";

export default function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const { data, error, reload } = useData(() => apiClient.getAgent(agentId), [agentId]);
  const [tab, setTab] = useState<Tab>("profile");

  if (error) {
    return <div className="pad"><div className="banner error">{error}</div></div>;
  }
  if (!data) {
    return <div className="pad"><div className="spinner" /></div>;
  }

  const agent = data.agent;
  const owned = agent.isOwnedByYou ?? false;

  const toggleNotesEdit = async () => {
    await apiClient.updateAgent(agent.id, { notesAgentEditable: !agent.notesAgentEditable });
    reload();
  };

  return (
    <>
      <header className="topbar">
        <Link href="/agents" className="btn icon ghost">
          <ArrowLeft size={16} />
        </Link>
        <Avatar name={agent.name} size={30} />
        <div>
          <div className="row gap-2">
            <h1>{agent.name}</h1>
            <span className="mono">@{agent.handle}</span>
          </div>
        </div>
        <span className="pill">
          <span className={`dot ${agent.presence?.status ?? "offline"}`} />
          {agent.presence?.activityTitle ?? agent.presence?.status ?? "offline"}
        </span>
        {owned ? <span className="badge">Owned by you</span> : <span className="pill">by {agent.ownerName}</span>}
        <div style={{ marginLeft: "auto" }} className="row gap-2">
          {owned ? (
            <Link href="/connect" className="btn sm">
              <Plug size={14} /> Connect a tool
            </Link>
          ) : null}
        </div>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>
          Profile
        </button>
        {owned ? (
          <button className={`tab ${tab === "notes" ? "active" : ""}`} onClick={() => setTab("notes")}>
            Private notes
          </button>
        ) : null}
        <button className={`tab ${tab === "workspace" ? "active" : ""}`} onClick={() => setTab("workspace")}>
          Workspace
        </button>
      </div>

      <div className="scroll pad">
        <div className="row gap-3 muted" style={{ fontSize: 12, marginBottom: 16 }}>
          <span>{providerLabel(agent.provider)}</span>
          <span>created {formatTime(agent.createdAt)}</span>
          <span>last seen {formatTime(agent.lastSeenAt)}</span>
        </div>

        {tab === "profile" ? (
          <DocEditor documentId={agent.profileDocumentId ?? null} canEdit={owned} />
        ) : null}

        {tab === "notes" && owned ? (
          <div className="col gap-3">
            <div className="banner info row between">
              <span>
                Agent self-editing of notes is {agent.notesAgentEditable ? "enabled" : "disabled"}. When
                enabled, the agent may write to its own notes via MCP.
              </span>
              <button className="btn sm" onClick={() => void toggleNotesEdit()}>
                {agent.notesAgentEditable ? "Disable" : "Enable"} agent edits
              </button>
            </div>
            <DocEditor documentId={agent.notesDocumentId ?? null} canEdit={owned} privateNote />
          </div>
        ) : null}

        {tab === "workspace" ? (
          agent.workspaceProjectId ? (
            <Link href={`/p/${agent.workspaceProjectId}`} className="list-item" style={{ maxWidth: 420 }}>
              <FolderGit2 size={18} className="muted" />
              <div className="grow">
                <div className="title">Open {agent.name}&apos;s workspace</div>
                <div className="sub">A private project for this agent&apos;s scratch work.</div>
              </div>
            </Link>
          ) : (
            <p className="muted">No workspace project.</p>
          )
        ) : null}
      </div>
    </>
  );
}
