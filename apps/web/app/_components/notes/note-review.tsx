"use client";

import type { NoteReview, NoteReviewChoice, NoteReviewDecision, NoteReviewItem } from "@lib/contracts/note-review";
import { ChevronLeftIcon, ChevronRightIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Locale } from "../ink/copy";
import { NOTE_REVIEW_COPY } from "./note-review-copy";
import type { NoteReviewExit } from "./note-review-exit";
import { addDays, layoutWeek, type WeekBlock } from "./note-week-layout";

// The note review (calendar-note-review design 7) as a week, like Google
// Calendar and like the slot image that follows it in the chat onboarding: the
// days on a vertical hour axis, all-day entries under the day headings, the
// candidates in yellow with a checkbox each, and the host's other plans in grey
// for context. A checked candidate becomes free; those the classifier
// recommends as notes start checked, and the classifier's reason is the block's
// tooltip. Checking an entry that repeats checks the whole series. Confirm
// records only the candidates of the weeks the host has looked at, so nothing is
// freed unseen. Standalone, so the web setup's notes step, /app/notes and later
// the redesigned settings can hold it. The look follows DESIGN.md until the
// mock-ups are applied.

type Copy = (typeof NOTE_REVIEW_COPY)[Locale];
type Choice = "free" | "keep_busy";

const HOUR_PX = 48;

function tag(locale: Locale) {
  return locale === "ko" ? "ko-KR" : "en-US";
}

function clock(iso: string, locale: Locale, timeZone: string) {
  return new Intl.DateTimeFormat(tag(locale), { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}

// An hour on the axis, short: "오전 9시", "9 AM".
function hourLabel(hour: number, locale: Locale) {
  return new Intl.DateTimeFormat(tag(locale), { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 5, hour)));
}

function dayHeading(date: string, locale: Locale) {
  const instant = new Date(`${date}T00:00:00Z`);
  return {
    day: instant.getUTCDate(),
    weekday: new Intl.DateTimeFormat(tag(locale), { timeZone: "UTC", weekday: "short" }).format(instant),
  };
}

function weekLabel(start: string, locale: Locale) {
  const format = new Intl.DateTimeFormat(tag(locale), { day: "numeric", month: "short", timeZone: "UTC" });
  return format.formatRange(new Date(`${start}T00:00:00Z`), new Date(`${addDays(start, 6)}T00:00:00Z`));
}


export function NoteReviewWeek({
  busy = false,
  confirmLabel,
  locale,
  onConfirm,
  onContinue,
  onWeek,
  review,
}: {
  readonly review: NoteReview;
  readonly locale: Locale;
  readonly busy?: boolean;
  readonly confirmLabel?: string;
  readonly onConfirm: (choices: NoteReviewChoice[]) => void;
  // With nothing left to check, a host of the review that moves on (the setup step).
  readonly onContinue?: () => void;
  readonly onWeek?: (start: string) => void;
}) {
  const t = NOTE_REVIEW_COPY[locale];
  const items = review.items;
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  const [choices, setChoices] = useState<ReadonlyMap<string, Choice>>(
    // The host's standing answer, or the classifier's recommendation.
    () => new Map(items.map((item) => [item.key, item.decision ?? (item.verdict === "note" ? "free" : "keep_busy")])),
  );
  const layout = useMemo(() => (review.week ? layoutWeek(review.week, items) : null), [review.week, items]);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(layout?.itemKeys ?? []));

  // Candidates count as seen once their week has been shown.
  useEffect(() => {
    if (!layout) return;
    setSeen((current) => {
      const missing = [...layout.itemKeys].filter((key) => !current.has(key));
      return missing.length === 0 ? current : new Set([...current, ...missing]);
    });
  }, [layout]);

  const choose = (key: string, choice: Choice) => setChoices((current) => new Map(current).set(key, choice));
  const seenItems = items.filter((item) => seen.has(item.key));
  const confirm = () =>
    onConfirm(
      // Unanswered entries the host has seen, and answers the host changed.
      seenItems
        .filter((item) => item.decision === null || choices.get(item.key) !== item.decision)
        .map((item) => ({
          decision: choices.get(item.key) ?? "keep_busy",
          key: item.key,
          ...(item.repeats ? { scope: "series" as const } : {}),
        })),
    );

  const week = review.week;
  const timeZone = week?.timezone ?? "UTC";

  return (
    <div className="flex flex-col gap-4" data-note-review>
      {review.state !== "ready" ? (
        <p className="text-muted-foreground" role="status">
          {review.state === "pending" ? t.pending : t.unavailable}
        </p>
      ) : items.length === 0 ? (
        <div className="flex flex-col gap-3">
          {onContinue ? (
            <div>
              <Button className="min-h-11" disabled={busy} onClick={onContinue} type="button">
                {t.continue}
              </Button>
            </div>
          ) : null}
        </div>
      ) : week && layout ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-primary tabular-nums" data-note-week={week.start}>
              {weekLabel(week.start, locale)}
            </p>
            <div className="flex items-center gap-1">
              <Button
                aria-label={t.previousWeek}
                className="size-9 rounded-full"
                disabled={busy || !week.previous}
                onClick={() => week.previous && onWeek?.(week.previous)}
                size="icon"
                type="button"
                variant="secondary"
              >
                <ChevronLeftIcon aria-hidden />
              </Button>
              <Button
                aria-label={t.nextWeek}
                className="size-9 rounded-full"
                disabled={busy || !week.next}
                onClick={() => week.next && onWeek?.(week.next)}
                size="icon"
                type="button"
                variant="secondary"
              >
                <ChevronRightIcon aria-hidden />
              </Button>
            </div>
          </div>

          {/* The soft board holding the white week card, as in the slot image. */}
          <div className="rounded-[24px] bg-secondary p-2 sm:p-3">
            <div className="overflow-x-auto rounded-2xl bg-card" data-note-week-grid>
              <div className="min-w-[600px] px-2 pt-3 pb-2">
                <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] gap-x-1.5">
                  <span />
                  {layout.days.map((day) => {
                    const heading = dayHeading(day.date, locale);
                    const today = day.date === week.today;
                    return (
                      <div className="flex flex-col items-center pb-1.5" key={day.date}>
                        <span className={cn("text-xs font-semibold", today ? "text-primary" : "text-muted-foreground")}>{heading.weekday}</span>
                        <span
                          className={cn(
                            "flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                            today ? "bg-primary text-primary-foreground" : "text-foreground",
                          )}
                        >
                          {heading.day}
                        </span>
                      </div>
                    );
                  })}

                  <span className="pt-1 pr-2 text-right text-[11px] text-muted-foreground">{t.allDay}</span>
                  {layout.days.map((day) => (
                    <div className="flex min-h-7 flex-col gap-1 border-b border-secondary pb-1.5" data-note-all-day={day.date} key={day.date}>
                      {day.allDay.map((block) => (
                        <Block
                          block={block}
                          choice={block.itemKey ? choices.get(block.itemKey) : undefined}
                          compact
                          key={block.id}
                          disabled={busy}
                          item={block.itemKey ? byKey.get(block.itemKey) : undefined}
                          locale={locale}
                          onChoose={choose}
                          t={t}
                          timeZone={timeZone}
                        />
                      ))}
                    </div>
                  ))}
                </div>

                <div className="mt-1 grid grid-cols-[56px_repeat(7,minmax(0,1fr))] gap-x-1.5">
                  <div className="relative" style={{ height: (layout.lastHour - layout.firstHour) * HOUR_PX }}>
                    {Array.from({ length: layout.lastHour - layout.firstHour }, (_, index) => layout.firstHour + index).map((hour) => (
                      <span
                        className="absolute right-2 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums"
                        key={hour}
                        style={{ top: (hour - layout.firstHour) * HOUR_PX }}
                      >
                        {hour === layout.firstHour ? "" : hourLabel(hour, locale)}
                      </span>
                    ))}
                  </div>
                  {layout.days.map((day) => (
                    <div
                      className="relative rounded-xl bg-background"
                      data-note-day={day.date}
                      key={day.date}
                      style={{ height: (layout.lastHour - layout.firstHour) * HOUR_PX }}
                    >
                      {day.timed.map((block) => (
                        <div
                          className="absolute px-0.5"
                          key={block.id}
                          style={{
                            height: Math.max(((block.endMinute - block.startMinute) / 60) * HOUR_PX, 20),
                            left: `${(block.lane / block.lanes) * 100}%`,
                            top: ((block.startMinute - layout.firstHour * 60) / 60) * HOUR_PX,
                            width: `${100 / block.lanes}%`,
                          }}
                        >
                          <Block
                            block={block}
                            choice={block.itemKey ? choices.get(block.itemKey) : undefined}
                            key={block.id}
                            disabled={busy}
                            item={block.itemKey ? byKey.get(block.itemKey) : undefined}
                            locale={locale}
                            onChoose={choose}
                            t={t}
                            timeZone={timeZone}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {week.contextUnavailable ? <p className="text-sm text-warning">{t.contextUnavailable}</p> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button className="min-h-11" disabled={busy || seenItems.length === 0} onClick={confirm} type="button">
              {busy ? t.confirming : (confirmLabel ?? t.confirm)}
            </Button>
          </div>
        </>
      ) : null}

    </div>
  );
}

// One entry on the week. A candidate is a checkbox: checked, it becomes free.
// The host's other plans are quiet grey context.
function Block({
  block,
  choice,
  compact = false,
  disabled,
  item,
  locale,
  onChoose,
  t,
  timeZone,
}: {
  readonly block: WeekBlock;
  readonly choice: Choice | undefined;
  readonly compact?: boolean;
  readonly disabled: boolean;
  readonly item: NoteReviewItem | undefined;
  readonly locale: Locale;
  readonly onChoose: (key: string, choice: Choice) => void;
  readonly t: Copy;
  readonly timeZone: string;
}) {
  const time = block.allDay ? null : clock(block.start, locale, timeZone);
  const title = block.title || t.untitled;

  if (block.kind === "busy" || !item) {
    return (
      <div
        className={cn("h-full overflow-hidden rounded-lg bg-secondary px-1.5 text-[11px] leading-tight text-muted-foreground", compact ? "py-0.5" : "py-1")}
        data-note-busy
        title={title}
      >
        <span className="block truncate font-semibold">{title}</span>
        {time ? <span className="block truncate tabular-nums">{time}</span> : null}
      </div>
    );
  }

  const free = choice === "free";
  // The classifier's reason, on hover, so the week stays uncluttered.
  const hint = item.reason ? `${title} · ${item.reason}` : title;
  return (
    <label
      className={cn(
        "flex h-full w-full cursor-pointer items-start gap-1 overflow-hidden rounded-lg px-1.5 text-[11px] leading-tight text-foreground transition-colors",
        compact ? "py-0.5" : "py-1",
        free ? "bg-warning/25 ring-1 ring-warning/60" : "border border-dashed border-warning/70 bg-card",
        disabled && "cursor-default opacity-70",
      )}
      data-note-block={free ? "free" : "busy"}
      data-note-occurrence={block.occurrenceId}
      title={hint}
    >
      <input
        aria-label={`${title}${time ? ` ${time}` : ""}`}
        checked={free}
        className="mt-px size-3.5 shrink-0 accent-primary"
        disabled={disabled}
        onChange={(event) => onChoose(item.key, event.target.checked ? "free" : "keep_busy")}
        type="checkbox"
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{title}</span>
        {time ? <span className="truncate text-muted-foreground tabular-nums">{time}</span> : null}
      </span>
    </label>
  );
}

function decisionTime(decision: NoteReviewDecision, locale: Locale, timeZone: string, t: Copy) {
  if (!decision.start) return null;
  if (decision.allDay) {
    const day = new Intl.DateTimeFormat(tag(locale), { day: "numeric", month: "short", timeZone: "UTC", weekday: "short" }).format(
      new Date(`${decision.start}T00:00:00Z`),
    );
    return `${day} · ${t.allDay}`;
  }
  const day = new Intl.DateTimeFormat(tag(locale), { day: "numeric", month: "short", timeZone, weekday: "short" }).format(new Date(decision.start));
  return `${day} · ${clock(decision.start, locale, timeZone)}${decision.end ? `–${clock(decision.end, locale, timeZone)}` : ""}`;
}

// After Confirm: the entries now free, each with its day and time, under one
// quiet line that they are written to Google Calendar. Only a failed writeback
// gets words, since that entry is still busy. The main button takes the host
// back to the chat they set up in (iMessage, WhatsApp or Telegram), or to the
// workspace without one; Back returns to the week to change an answer.
export function NoteReviewDone({
  busy = false,
  exit,
  locale,
  onBack,
  onRetry,
  review,
}: {
  readonly review: NoteReview;
  readonly locale: Locale;
  readonly busy?: boolean;
  readonly exit: NoteReviewExit;
  readonly onBack: () => void;
  readonly onRetry?: (decisionId: string) => void;
}) {
  const t = NOTE_REVIEW_COPY[locale];
  const timeZone = review.week?.timezone ?? "UTC";
  const freed = review.decisions.filter((decision) => decision.decision === "free");

  return (
    <div className="flex flex-col gap-4" data-note-review-done>
      {freed.length > 0 ? (
        <section aria-label={t.decided} className="flex flex-col gap-2">
          <div className="flex flex-col">
            <h3 className="text-sm font-semibold text-foreground">{t.decided}</h3>
            <p className="text-xs text-muted-foreground">{t.savedToGoogle}</p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {freed.map((decision) => {
              const time = decisionTime(decision, locale, timeZone, t);
              return (
                <li
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl bg-secondary px-3 py-2 text-sm"
                  data-note-decision={decision.writebackState ?? "none"}
                  key={decision.id}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium break-words">{decision.title ?? t.untitled}</span>
                    {time ? <span className="text-xs text-muted-foreground tabular-nums">{time}</span> : null}
                  </span>
                  {decision.writebackState === "failed" ? (
                    <span className="w-full text-xs text-destructive" role="alert">
                      {t.state.failed}
                    </span>
                  ) : null}
                  {decision.writebackState === "failed" && onRetry ? (
                    <Button className="min-h-9" disabled={busy} onClick={() => onRetry(decision.id)} size="sm" type="button" variant="outline">
                      <RotateCcwIcon aria-hidden />
                      {t.retry}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild className="min-h-11">
          <a data-note-exit={exit.channel ?? "app"} href={exit.href}>
            {exit.channel ? t.backTo[exit.channel] : t.done}
          </a>
        </Button>
        <Button className="min-h-11" disabled={busy} onClick={onBack} type="button" variant="secondary">
          <ChevronLeftIcon aria-hidden />
          {t.back}
        </Button>
      </div>
    </div>
  );
}
