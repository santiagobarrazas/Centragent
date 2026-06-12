"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, MessagesSquare, Plus, Users } from "lucide-react";
import { apiClient, type Agent } from "@/lib/api";
import { DocEditor } from "@/components/DocEditor";
import { Avatar, formatTime, providerLabel, useData } from "@/lib/ui";

type Tab = "overview" | "conversations" | "members" | "assets";

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");

  const project = useData(() => apiClient.getProject(projectId), [projectId]);
  const conversations = useData(() => apiClient.listProjectConversations(projectId), [projectId]);
  const members = useData(() => apiClient.listMembers(projectId), [projectId]);
  const assets = useData(() => apiClient.listAssets(projectId), [projectId]);

  const [convTitle, setConvTitle] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [openAsset, setOpenAsset] = useState<string | null>(null);
  const [assetTitle, setAssetTitle] = useState("");
  const [addingAgent, setAddingAgent] = useState(false);
  const [ownedAgents, setOwnedAgents] = useState<Agent[]>([]);

  if (project.error) {
    return <div className="pad"><div className="banner error">{project.error}</div></div>;
  }

  const createConversation = async () => {
    if (!convTitle.trim()) return;
    const result = await apiClient.createConversation(projectId, convTitle.trim());
    setConvTitle("");
    router.push(`/p/${projectId}/c/${result.conversation.id}`);
  };

  const createAsset = async () => {
    if (!assetTitle.trim()) return;
    await apiClient.createAsset(projectId, assetTitle.trim(), `# ${assetTitle.trim()}\n\n`);
    setAssetTitle("");
    assets.reload();
  };

  const invite = async () => {
    const result = await apiClient.createInvite(projectId, "member");
    setInviteCode(result.code);
  };

  const openAddAgent = async () => {
    setAddingAgent(true);
    const response = await apiClient.listAgents();
    setOwnedAgents(response.agents);
  };

  const addAgentToProject = async (agentId: string) => {
    await apiClient.addAgentToProject(projectId, agentId);
    setAddingAgent(false);
    members.reload();
  };

  return (
    <>
      <header className="topbar">
        <Link href="/" className="btn icon ghost"><ArrowLeft size={16} /></Link>
        <h1>{project.data?.project.name ?? "…"}</h1>
        {project.data?.project.kind === "agent_workspace" ? <span className="badge">workspace</span> : null}
      </header>

      <div className="tabs">
        {(["overview", "conversations", "members", "assets"] as Tab[]).map((value) => (
          <button key={value} className={`tab ${tab === value ? "active" : ""}`} onClick={() => setTab(value)}>
            {value[0]!.toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>

      <div className="scroll pad">
        {tab === "overview" ? (
          <DocEditor documentId={project.data?.project.overviewDocumentId ?? null} canEdit />
        ) : null}

        {tab === "conversations" ? (
          <div className="col" style={{ maxWidth: 720 }}>
            <form
              className="row gap-2"
              style={{ marginBottom: 16 }}
              onSubmit={(event) => {
                event.preventDefault();
                void createConversation();
              }}
            >
              <input
                className="field"
                placeholder="New conversation title"
                value={convTitle}
                onChange={(event) => setConvTitle(event.target.value)}
              />
              <button className="btn primary" type="submit" disabled={!convTitle.trim()}>
                <Plus size={16} /> New
              </button>
            </form>
            {conversations.data?.conversations.length === 0 ? (
              <div className="empty"><MessagesSquare size={26} /><div>No conversations yet.</div></div>
            ) : null}
            {conversations.data?.conversations.map((conversation) => (
              <Link key={conversation.id} href={`/p/${projectId}/c/${conversation.id}`} className="list-item">
                <MessagesSquare size={16} className="muted" />
                <div className="grow">
                  <div className="title">{conversation.title}</div>
                  <div className="sub">{conversation.participantCount ?? 0} participants</div>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>{formatTime(conversation.lastMessageAt)}</span>
              </Link>
            ))}
          </div>
        ) : null}

        {tab === "members" ? (
          <div className="col" style={{ maxWidth: 640 }}>
            <div className="row between" style={{ marginBottom: 12 }}>
              <strong className="row gap-2"><Users size={16} /> Members</strong>
              <div className="row gap-2">
                <button
                  className="btn sm"
                  onClick={() => (addingAgent ? setAddingAgent(false) : void openAddAgent())}
                >
                  <Plus size={14} /> Add agent
                </button>
                <button className="btn sm ghost" onClick={() => void invite()}>Invite person</button>
              </div>
            </div>
            {addingAgent
              ? (() => {
                  const present = new Set(
                    (members.data?.members ?? []).map((m) => m.agent?.id).filter(Boolean)
                  );
                  const available = ownedAgents.filter((agent) => !present.has(agent.id));
                  return (
                    <div className="card pad col gap-1" style={{ marginBottom: 12 }}>
                      {available.length === 0 ? (
                        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                          {ownedAgents.length === 0
                            ? "You don't own any agents yet. Connect a tool or create one from an agent's page."
                            : "All your agents are already in this project."}
                        </p>
                      ) : (
                        available.map((agent) => (
                          <button
                            key={agent.id}
                            className="participant"
                            style={{ width: "100%" }}
                            onClick={() => void addAgentToProject(agent.id)}
                          >
                            <Avatar name={agent.name} size={24} />
                            <div className="info">
                              <div className="name">{agent.name}</div>
                              <div className="status">
                                @{agent.handle} · {providerLabel(agent.provider)}
                              </div>
                            </div>
                            <Plus size={14} className="muted" />
                          </button>
                        ))
                      )}
                    </div>
                  );
                })()
              : null}
            {inviteCode ? (
              <div className="banner info col gap-2" style={{ display: "block" }}>
                <div>Share this invite code (expires in 14 days):</div>
                <div className="code-box">{inviteCode}</div>
              </div>
            ) : null}
            {members.data?.members.map((member) => (
              <div className="list-item" key={member.id}>
                {member.user ? (
                  <>
                    <Avatar name={member.user.name} color={member.user.avatarColor} size={26} />
                    <div className="grow">
                      <div className="title" style={{ fontSize: 13 }}>{member.user.name}</div>
                      <div className="sub">{member.user.email ?? "user"}</div>
                    </div>
                  </>
                ) : member.agent ? (
                  <>
                    <Avatar name={member.agent.name} size={26} />
                    <div className="grow">
                      <Link href={`/a/${member.agent.id}`} className="title" style={{ fontSize: 13 }}>
                        {member.agent.name} <span className="mono">@{member.agent.handle}</span>
                      </Link>
                      <div className="sub">{providerLabel(member.agent.provider)} · agent</div>
                    </div>
                  </>
                ) : null}
                <span className="pill">{member.role}</span>
              </div>
            ))}
          </div>
        ) : null}

        {tab === "assets" ? (
          <div className="col" style={{ maxWidth: 820 }}>
            {openAsset ? (
              <>
                <button className="btn sm ghost" style={{ alignSelf: "flex-start", marginBottom: 12 }} onClick={() => setOpenAsset(null)}>
                  <ArrowLeft size={14} /> All assets
                </button>
                <DocEditor documentId={openAsset} canEdit />
              </>
            ) : (
              <>
                <form
                  className="row gap-2"
                  style={{ marginBottom: 16 }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createAsset();
                  }}
                >
                  <input
                    className="field"
                    placeholder="New asset title (e.g. Architecture)"
                    value={assetTitle}
                    onChange={(event) => setAssetTitle(event.target.value)}
                  />
                  <button className="btn primary" type="submit" disabled={!assetTitle.trim()}>
                    <Plus size={16} /> New
                  </button>
                </form>
                {assets.data?.assets.map((asset) => (
                  <button key={asset.id} className="list-item" onClick={() => setOpenAsset(asset.id)}>
                    <FileText size={16} className="muted" />
                    <div className="grow">
                      <div className="title" style={{ fontSize: 13 }}>{asset.title}</div>
                      <div className="sub">{asset.kind === "project_overview" ? "overview" : "asset"}</div>
                    </div>
                    <span className="muted" style={{ fontSize: 12 }}>{formatTime(asset.updatedAt)}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
