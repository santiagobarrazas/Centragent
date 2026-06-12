// Pure mention helpers (no DOM) — easy to reason about and test.

/** The in-progress "@query" immediately before the caret, if any. */
export function activeMention(
  text: string,
  caret: number
): { query: string; start: number } | null {
  let index = caret - 1;
  while (index >= 0) {
    const char = text[index];
    if (char === "@") {
      const before = index === 0 ? " " : text[index - 1] ?? " ";
      // "@" must follow a non-word, non-"@" char so emails (a@b) don't trigger.
      if (/[\w@]/.test(before)) return null;
      const query = text.slice(index + 1, caret);
      if (!/^[a-zA-Z0-9_-]*$/.test(query)) return null;
      return { query, start: index };
    }
    if (!/[a-zA-Z0-9_-]/.test(char ?? "")) return null;
    index -= 1;
  }
  return null;
}

/** Replace the active "@query" with "@handle " and return the new caret. */
export function commitMention(
  text: string,
  start: number,
  caret: number,
  handle: string
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(caret);
  const insert = `@${handle} `;
  return { text: `${before}${insert}${after}`, caret: before.length + insert.length };
}

export type MentionToken =
  | { type: "text"; value: string }
  | { type: "mention"; handle: string; raw: string };

/** Split content into plain text and @handle tokens (boundary-aware). */
export function tokenize(content: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  const regex = /(^|[^\w@])@([a-zA-Z0-9_-]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const lead = match[1] ?? "";
    const handle = match[2] ?? "";
    const atIndex = match.index + lead.length;
    if (atIndex > last) {
      tokens.push({ type: "text", value: content.slice(last, atIndex) });
    }
    tokens.push({ type: "mention", handle, raw: `@${handle}` });
    last = atIndex + 1 + handle.length;
  }
  if (last < content.length) {
    tokens.push({ type: "text", value: content.slice(last) });
  }
  return tokens;
}

/** Lowercased agent-handle → participant (agent participants only). */
export function buildHandleMap<T extends { agent: { handle: string } | null }>(
  participants: T[]
): Map<string, T> {
  const map = new Map<string, T>();
  for (const participant of participants) {
    if (participant.agent) {
      map.set(participant.agent.handle.toLowerCase(), participant);
    }
  }
  return map;
}

/** Agent participants whose handle starts with the (lowercased) query. */
export function matchHandles<T extends { agent: { handle: string } | null }>(
  participants: T[],
  query: string,
  limit = 8
): T[] {
  const q = query.toLowerCase();
  return participants
    .filter((p): p is T => Boolean(p.agent) && p.agent!.handle.toLowerCase().startsWith(q))
    .slice(0, limit);
}
