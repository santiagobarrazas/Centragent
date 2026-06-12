"use client";

import { useCallback, useRef, useState } from "react";
import { type Participant } from "@/lib/api";
import { activeMention, commitMention, matchHandles } from "@/lib/mentions";
import { getCaretCoordinates } from "@/lib/caret";
import { Avatar, providerLabel } from "@/lib/ui";

// A native <textarea> with an @mention autocomplete anchored at the caret.
// Keeping the textarea (not a rich editor) means plain "@handle" text is sent
// verbatim and the server's mention parser still works.
export function MentionTextarea({
  value,
  onChange,
  onSubmit,
  participants,
  placeholder,
  disabled = false
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  participants: Participant[];
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Participant[]>([]);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number }>({ left: 0 });
  const startRef = useRef(0);

  const recompute = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const mention = activeMention(value, caret);
    if (!mention) {
      setOpen(false);
      return;
    }
    const matches = matchHandles(participants, mention.query);
    if (matches.length === 0) {
      setOpen(false);
      return;
    }
    const coords = getCaretCoordinates(el, mention.start);
    startRef.current = mention.start;
    setPos({ left: Math.max(0, coords.left - el.scrollLeft) });
    setItems(matches);
    setActive(0);
    setOpen(true);
  }, [participants, value]);

  const commit = (participant: Participant) => {
    const el = ref.current;
    const handle = participant.agent?.handle;
    if (!el || !handle) return;
    const caret = el.selectionStart ?? value.length;
    const next = commitMention(value, startRef.current, caret, handle);
    onChange(next.text);
    setOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <div className="ta-wrap">
      <textarea
        ref={ref}
        className="field"
        rows={2}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          requestAnimationFrame(recompute);
        }}
        onClick={recompute}
        onKeyUp={(event) => {
          if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
            recompute();
          }
        }}
        onKeyDown={(event) => {
          if (open) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => (index + 1) % items.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => (index - 1 + items.length) % items.length);
            } else if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              const chosen = items[active];
              if (chosen) commit(chosen);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        role="combobox"
        aria-expanded={open}
        aria-controls="mention-listbox"
        aria-autocomplete="list"
      />
      {open ? (
        <ul className="mention-pop" id="mention-listbox" role="listbox" style={{ left: pos.left }}>
          {items.map((participant, index) => (
            <li
              key={participant.id}
              role="option"
              aria-selected={index === active}
              className={`mention-option ${index === active ? "active" : ""}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                commit(participant);
              }}
            >
              <Avatar name={participant.agent?.name ?? "?"} size={22} />
              <div className="grow">
                <div className="name">{participant.agent?.name}</div>
                <div className="sub mono">
                  @{participant.agent?.handle} · {providerLabel(participant.agent?.provider ?? "")}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
