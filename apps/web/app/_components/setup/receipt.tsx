"use client";

import { CheckIcon, CornerRightDownIcon, MinusIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemMedia } from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { CALENDARS_CARD_ID } from "./calendar-cards";
import { focusCard, SourceBadge } from "./card";
import type { Receipt } from "./receipts";
import { useSetup, useStepper } from "./setup-context";

// A receipt: an answered setup card collapsed into one quiet line that stays in
// the conversation where it was answered. It names the step, the value and its
// source, with **Edit**, which asks the step again in a fresh card at the bottom
// rather than reopening this one. A receipt whose answer was changed later shows
// the old value struck through with **Changed below**, which goes to the newer
// receipt. It is lighter than a message: small text, no surface, one line.

export function receiptElementId(id: string) {
  return `setup-receipt-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function goToReceipt(id: string) {
  const element = document.getElementById(receiptElementId(id));
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.focus({ preventScroll: true });
}

// "3:42 PM" today, "Oct 20, 3:42 PM" on another day.
export function formatReceiptTime(at: string, now = new Date()) {
  const date = new Date(at);
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay ? {} : { day: "numeric", month: "short" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function SetupReceipt({ receipt }: { readonly receipt: Receipt }) {
  const { busy, setEditingCalendars, state } = useSetup();
  const stepper = useStepper();
  const changed = receipt.changedTo !== null;
  const skipped = receipt.kind === "skipped";
  const confirmed = receipt.kind === "confirmed";
  const value = confirmed && receipt.at ? formatReceiptTime(receipt.at) : receipt.value;
  const Icon = confirmed ? ShieldCheckIcon : skipped ? MinusIcon : changed ? CornerRightDownIcon : CheckIcon;
  const subject = receipt.label.toLowerCase();

  let action = null;
  if (changed) {
    action = (
      <Button
        aria-label={`Changed below: go to the newer ${subject} answer`}
        className="h-8 min-h-8 px-1 text-xs text-muted-foreground"
        onClick={() => goToReceipt(receipt.changedTo!)}
        type="button"
        variant="link"
      >
        Changed below
      </Button>
    );
  } else if (receipt.step) {
    const step = receipt.step;
    action = (
      <Button
        aria-label={`Edit ${subject}`}
        className="h-8 min-h-8 px-1 text-xs"
        disabled={busy !== null || !stepper.canEdit}
        onClick={() => stepper.edit(step)}
        type="button"
        variant="link"
      >
        Edit
      </Button>
    );
  } else if (receipt.kind === "calendars") {
    action = (
      <Button
        aria-label="Edit calendars"
        className="h-8 min-h-8 px-1 text-xs"
        disabled={busy !== null || !state.calendar.connected}
        onClick={() => {
          setEditingCalendars(true);
          focusCard(CALENDARS_CARD_ID);
        }}
        type="button"
        variant="link"
      >
        Edit
      </Button>
    );
  }

  return (
    <Item
      className={cn(
        // border-0: the app's base border color would otherwise outline the row.
        "setup-receipt-enter min-h-8 flex-nowrap gap-2 rounded-md border-0 px-1 py-0 text-sm outline-none focus-visible:ring-2",
        changed || skipped ? "text-muted-foreground" : "text-foreground",
      )}
      data-setup-receipt={receipt.step ?? receipt.kind}
      data-state={changed ? "changed" : skipped ? "skipped" : "current"}
      id={receiptElementId(receipt.id)}
      size="xs"
      tabIndex={-1}
    >
      <ItemMedia
        className={cn(
          "size-5 rounded-full border [&_svg]:size-3",
          changed || skipped ? "border-border text-muted-foreground" : "border-success/40 text-success",
        )}
      >
        <Icon aria-hidden />
      </ItemMedia>
      <p className="flex min-w-0 flex-1 items-baseline gap-1.5" title={value ? `${receipt.label} · ${value}` : receipt.label}>
        <span className="shrink-0 text-muted-foreground">{receipt.label}</span>
        {value ? (
          <>
            <span aria-hidden className="shrink-0 text-muted-foreground/70">
              ·
            </span>
            <span
              className={cn(
                "min-w-0 truncate",
                changed ? "line-through decoration-muted-foreground/60" : skipped ? "pr-0.5 italic" : "font-medium",
              )}
            >
              {changed ? <span className="sr-only">Earlier answer: </span> : null}
              {value}
            </span>
          </>
        ) : null}
      </p>
      {receipt.source && !changed ? (
        <span className="hidden shrink-0 sm:inline-flex">
          <SourceBadge source={receipt.source} />
        </span>
      ) : null}
      {action ? <ItemActions className="shrink-0">{action}</ItemActions> : null}
    </Item>
  );
}

// A run of consecutive receipts, as one quiet list between messages.
export function SetupReceipts({ receipts }: { readonly receipts: readonly Receipt[] }) {
  return (
    <ul aria-label="Setup answers" className="flex min-w-0 flex-col">
      {receipts.map((receipt) => (
        <li className="min-w-0" key={receipt.id}>
          <SetupReceipt receipt={receipt} />
        </li>
      ))}
    </ul>
  );
}

// Says each new receipt politely, once: never the ones already there on load.
export function ReceiptAnnouncer({ receipts }: { readonly receipts: readonly Receipt[] }) {
  const seen = useRef<Set<string> | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const ids = new Set(receipts.map((receipt) => receipt.id));
    const previous = seen.current;
    seen.current = ids;
    if (!previous) return;
    const added = receipts.filter((receipt) => !previous.has(receipt.id)).at(-1);
    if (!added) return;
    setMessage(
      added.kind === "confirmed"
        ? "Settings confirmed."
        : added.kind === "skipped"
          ? `${added.label} skipped for now.`
          : `Saved. ${added.label}: ${added.value}.`,
    );
  }, [receipts]);

  return (
    <div aria-live="polite" className="sr-only" role="status">
      {message}
    </div>
  );
}
