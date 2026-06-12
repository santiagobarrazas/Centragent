"use client";

import { useEffect, useState } from "react";
import { Lock, Pencil } from "lucide-react";
import { apiClient } from "@/lib/api";
import { Markdown } from "@/lib/ui";

// Renders a living .md document with an inline edit toggle (when allowed).
export function DocEditor({
  documentId,
  canEdit,
  privateNote = false
}: {
  documentId: string | null;
  canEdit: boolean;
  privateNote?: boolean;
}) {
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!documentId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    apiClient
      .getDocument(documentId)
      .then((response) => {
        if (active) {
          setContent(response.document.currentContent);
          setError(null);
        }
      })
      .catch((caught: Error) => active && setError(caught.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [documentId]);

  if (!documentId) {
    return <p className="muted">No document yet.</p>;
  }
  if (loading) {
    return <div className="spinner" />;
  }
  if (error) {
    return <div className="banner error">{error}</div>;
  }

  const save = async () => {
    if (!documentId) return;
    setSaving(true);
    try {
      const response = await apiClient.updateDocument(documentId, draft);
      setContent(response.document.currentContent);
      setEditing(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}>
        {privateNote ? (
          <span className="pill">
            <Lock size={12} /> Private — visible only to the owner
          </span>
        ) : (
          <span />
        )}
        {canEdit && !editing ? (
          <button
            className="btn sm ghost"
            onClick={() => {
              setDraft(content);
              setEditing(true);
            }}
          >
            <Pencil size={14} /> Edit
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="col gap-2">
          <textarea
            className="field"
            value={draft}
            rows={18}
            style={{ fontFamily: "var(--mono)", fontSize: 13 }}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="row gap-2">
            <button className="btn primary sm" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save version"}
            </button>
            <button className="btn sm ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <Markdown>{content}</Markdown>
      )}
    </div>
  );
}
