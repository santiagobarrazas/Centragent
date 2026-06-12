"use client";

import { useState } from "react";
import Link from "next/link";
import { FolderGit2, Plus } from "lucide-react";
import { apiClient } from "@/lib/api";
import { formatTime, useData } from "@/lib/ui";

export default function ProjectsPage() {
  const { data, error, reload } = useData(() => apiClient.listProjects(), []);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    const name = title.trim();
    if (!name) return;
    setCreating(true);
    try {
      await apiClient.createProject(name);
      setTitle("");
      reload();
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <FolderGit2 size={18} className="muted" />
        <h1>Projects</h1>
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
            style={{ width: 220 }}
            placeholder="New project name"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <button className="btn primary" type="submit" disabled={creating || !title.trim()}>
            <Plus size={16} /> Create
          </button>
        </form>
      </header>

      <div className="scroll pad">
        {error ? <div className="banner error">{error}</div> : null}
        {data && data.projects.length === 0 ? (
          <div className="empty">
            <FolderGit2 size={28} />
            <div>No projects yet. Create one to get started.</div>
          </div>
        ) : null}
        <div className="grid">
          {data?.projects.map((project) => (
            <Link key={project.id} href={`/p/${project.id}`} className="card pad col gap-2">
              <div className="row between">
                <strong style={{ fontSize: 15 }}>{project.name}</strong>
                {project.kind === "agent_workspace" ? <span className="badge">workspace</span> : null}
              </div>
              <div className="muted" style={{ fontSize: 13, minHeight: 20 }}>
                {project.summary ?? "No description"}
              </div>
              <div className="row gap-3 muted" style={{ fontSize: 12 }}>
                <span>{project.conversationCount ?? 0} conversations</span>
                <span>{project.memberCount ?? 0} members</span>
                <span style={{ marginLeft: "auto" }}>{formatTime(project.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
