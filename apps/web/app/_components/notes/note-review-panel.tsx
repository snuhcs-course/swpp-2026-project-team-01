"use client";

import type { NoteReview, NoteReviewChoice } from "@lib/contracts/note-review";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Locale } from "../ink/copy";
import { readStatus, useMessagesPlatform } from "../imessage/imessage-card";
import { NoteReviewDone, NoteReviewWeek } from "./note-review";
import { type NoteReviewExit, noteReviewExit } from "./note-review-exit";
import { NOTE_REVIEW_COPY } from "./note-review-copy";

// The note review with its data: it reads /api/notes/review, confirms through
// /api/notes/commands with a fresh retry key, and polls while a writeback is
// pending so each row shows when Google Calendar has been updated.

const POLL_MS = 3000;
const MAX_POLLS = 40;

async function post(operation: string, input: unknown) {
  const response = await fetch("/api/notes/commands", {
    body: JSON.stringify({ input, operation, retryKey: crypto.randomUUID() }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: { category?: string } } | null;
  return { ok: response.ok && body?.ok === true, stale: body?.error?.category === "stale_revision" };
}

export function NoteReviewPanel({
  className,
  confirmLabel,
  headingId,
  locale,
  onConfirmed,
}: {
  readonly locale: Locale;
  readonly className?: string;
  readonly confirmLabel?: string;
  // Given on a page of its own, the panel shows its heading, which says the
  // entries are checked once Confirm has saved them.
  readonly headingId?: string;
  // After a successful 확인, for a host of the panel that moves on (the setup step).
  readonly onConfirmed?: () => void | Promise<void>;
}) {
  const t = NOTE_REVIEW_COPY[locale];
  const [review, setReview] = useState<NoteReview | null>(null);
  // Remounts the list, so its ticks start again from a new review.
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  // After Confirm the page shows what is now free, with Back to change it.
  const [done, setDone] = useState(false);
  // Where Done leads: the host's linked chat, read once the review is done.
  const platform = useMessagesPlatform();
  const [exit, setExit] = useState<NoteReviewExit>({ channel: null, href: "/app" });
  useEffect(() => {
    if (!done) return;
    let current = true;
    void readStatus().then((status) => {
      if (current) setExit(noteReviewExit(status, platform));
    });
    return () => {
      current = false;
    };
  }, [done, platform]);

  // The week on screen, kept when the review reloads after a confirmation or a poll.
  const week = useRef<string | null>(null);

  const load = useCallback(async (fresh: boolean, start: string | null = week.current) => {
    const response = await fetch(`/api/notes/review${start ? `?week=${encodeURIComponent(start)}` : ""}`, { cache: "no-store" });
    if (!response.ok) {
      setNotice(t.failedLoad);
      return null;
    }
    const next = (await response.json()) as NoteReview;
    week.current = next.week?.start ?? null;
    setReview(next);
    if (fresh) setVersion((current) => current + 1);
    return next;
  }, [t.failedLoad]);

  useEffect(() => {
    void load(true);
  }, [load]);

  const pending = review?.decisions.some((decision) => decision.writebackState === "pending") ?? false;
  useEffect(() => {
    if (!pending || polls >= MAX_POLLS) return;
    const timer = setTimeout(() => {
      setPolls((current) => current + 1);
      void load(false);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [load, pending, polls, review]);

  const confirm = async (choices: NoteReviewChoice[]) => {
    if (!review?.analysisId) return;
    setBusy(true);
    setNotice(null);
    try {
      // Nothing changed: there is nothing to save.
      const result = choices.length === 0 ? { ok: true, stale: false } : await post("notes.confirm_review", { analysisId: review.analysisId, choices });
      if (!result.ok) setNotice(result.stale ? t.stale : t.failedSave);
      setPolls(0);
      await load(true);
      if (result.ok && !onConfirmed) setDone(true);
      if (result.ok) await onConfirmed?.();
    } finally {
      setBusy(false);
    }
  };

  const retry = async (decisionId: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await post("notes.retry_writeback", { decisionId });
      if (!result.ok) setNotice(t.failedSave);
      setPolls(0);
      await load(false);
    } finally {
      setBusy(false);
    }
  };

  const back = async () => {
    setNotice(null);
    // The week starts again from the host's answers as they now stand.
    await load(true);
    setDone(false);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {headingId ? (
        <h1 className="font-display text-[26px] leading-[1.15] text-foreground" id={headingId}>
          {done ? t.doneTitle : t.title}
        </h1>
      ) : null}
      {notice ? (
        <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {notice}
        </p>
      ) : null}
      {review && done ? (
        <NoteReviewDone busy={busy} exit={exit} locale={locale} onBack={() => void back()} onRetry={(id) => void retry(id)} review={review} />
      ) : review ? (
        <NoteReviewWeek
          busy={busy}
          confirmLabel={confirmLabel}
          key={version}
          locale={locale}
          onConfirm={(choices) => void confirm(choices)}
          onContinue={onConfirmed ? () => void onConfirmed() : undefined}
          onWeek={(start) => void load(false, start)}
          review={review}
        />
      ) : (
        <p className="text-muted-foreground" role="status">
          {t.pending}
        </p>
      )}
    </div>
  );
}
