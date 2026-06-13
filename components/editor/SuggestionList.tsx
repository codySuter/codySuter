"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { createStubEntry } from "@/actions/entries";

interface Item {
  id: string;
  title: string;
  type: string;
}

export interface SuggestionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface Props {
  items: Item[];
  query: string;
  campaignId: string;
  command: (attrs: { id: string; label: string; entryType: string }) => void;
}

export const SuggestionList = forwardRef<SuggestionListRef, Props>(
  function SuggestionList({ items, query, command, campaignId }, ref) {
    const [index, setIndex] = useState(0);
    const showCreate = query.trim().length > 0;
    const total = items.length + (showCreate ? 1 : 0);

    useEffect(() => setIndex(0), [items, query]);

    const select = async (i: number) => {
      if (i < items.length) {
        const it = items[i];
        command({ id: it.id, label: it.title, entryType: it.type });
      } else if (showCreate) {
        const created = await createStubEntry(campaignId, query.trim());
        command({ id: created.id, label: created.title, entryType: "npc" });
      }
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        const n = Math.max(total, 1);
        if (event.key === "ArrowDown") {
          setIndex((i) => (i + 1) % n);
          return true;
        }
        if (event.key === "ArrowUp") {
          setIndex((i) => (i - 1 + n) % n);
          return true;
        }
        if (event.key === "Enter") {
          void select(index);
          return true;
        }
        return false;
      },
    }));

    return (
      <div className="w-72 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface-2 shadow-xl p-1 text-sm">
        {items.length === 0 && !showCreate && (
          <div className="px-2 py-1.5 text-muted">No matching pages</div>
        )}
        {items.map((it, i) => (
          <button
            key={it.id}
            onClick={() => void select(i)}
            onMouseEnter={() => setIndex(i)}
            className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left ${
              index === i ? "bg-primary/20 text-text" : "text-muted"
            }`}
          >
            <span className="truncate">{it.title}</span>
            <span className="shrink-0 text-xs opacity-60">{it.type}</span>
          </button>
        ))}
        {showCreate && (
          <button
            onClick={() => void select(items.length)}
            onMouseEnter={() => setIndex(items.length)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
              index === items.length ? "bg-accent/20 text-text" : "text-accent"
            }`}
          >
            <span className="text-xs">＋</span>
            <span className="truncate">Create “{query.trim()}”</span>
          </button>
        )}
      </div>
    );
  },
);
