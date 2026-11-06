"use client";

import type { KeyboardEvent } from "react";

// The tabs above a conversation: each names a view of the same column, and the
// arrow keys move between them. Panels use `tab-{id}` and `panel-{id}`.

export type ChatTab<T extends string> = { readonly id: T; readonly label: string };

export function ChatTabs<T extends string>({
  label,
  onSelect,
  selected,
  tabs,
}: {
  readonly label: string;
  readonly onSelect: (id: T) => void;
  readonly selected: T;
  readonly tabs: readonly ChatTab<T>[];
}) {
  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const at = tabs.findIndex((tab) => tab.id === selected);
    const next = tabs[(at + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!.id;
    onSelect(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  return (
    <div aria-label={label} className="flex gap-1 rounded-lg border border-border p-1" role="tablist">
      {tabs.map((entry) => (
        <button
          // Only the selected tab's panel is shown.
          aria-controls={selected === entry.id ? `panel-${entry.id}` : undefined}
          aria-selected={selected === entry.id}
          className="min-w-0 flex-1 truncate rounded-md px-3 py-1.5 text-sm aria-selected:bg-accent aria-selected:font-medium focus-visible:outline-2 focus-visible:outline-ring"
          id={`tab-${entry.id}`}
          key={entry.id}
          onClick={() => onSelect(entry.id)}
          onKeyDown={onKey}
          role="tab"
          tabIndex={selected === entry.id ? 0 : -1}
          type="button"
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
