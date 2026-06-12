"use client";

import { useMemo } from "react";
import { type Participant } from "@/lib/api";
import { buildHandleMap, tokenize } from "@/lib/mentions";
import { Avatar, providerLabel } from "@/lib/ui";

// Render message content with @handle tokens highlighted (when they map to a
// real agent participant) plus a hovercard. Non-matching @text stays plain.
export function MentionText({
  content,
  participants
}: {
  content: string;
  participants: Participant[];
}) {
  const map = useMemo(() => buildHandleMap(participants), [participants]);
  const tokens = useMemo(() => tokenize(content), [content]);

  return (
    <>
      {tokens.map((token, index) => {
        if (token.type === "text") {
          return <span key={index}>{token.value}</span>;
        }
        const participant = map.get(token.handle.toLowerCase());
        if (!participant?.agent) {
          return <span key={index}>{token.raw}</span>;
        }
        const agent = participant.agent;
        const presence = agent.presences?.[0];
        return (
          <span className="mention" key={index}>
            {token.raw}
            <span className="mention-card" role="tooltip">
              <Avatar name={agent.name} size={26} />
              <span className="mention-card-body">
                <span className="mention-card-name">{agent.name}</span>
                <span className="mono">
                  @{agent.handle} · {providerLabel(agent.provider)}
                </span>
                <span className="row gap-2" style={{ marginTop: 5 }}>
                  <span className={`dot ${presence?.status ?? "offline"}`} />
                  <span className="muted" style={{ fontSize: 12 }}>
                    {presence?.activityTitle ?? presence?.status ?? "offline"}
                  </span>
                </span>
              </span>
            </span>
          </span>
        );
      })}
    </>
  );
}
