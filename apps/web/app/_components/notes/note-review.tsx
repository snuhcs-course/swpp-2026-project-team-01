"use client";

import type { NoteReview, NoteReviewChoice, NoteReviewDecision, NoteReviewItem, NoteWeek } from "@lib/contracts/note-review";
import { ChevronLeftIcon, ChevronRightIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Locale } from "../ink/copy";
import { NOTE_REVIEW_COPY } from "./note-review-copy";
import type { NoteReviewExit } from "./note-review-exit";
import {
  candidateKeys,
  firstWindow,
  hourRange,
  layoutWeek,
  mondayOf,
  stepWindow,
  type WeekBlock,
  type WeekDay,
  windowDates,
  windowWeeks,
} from "./note-week-layout";

// The note review (calendar-note-review design 7) as a week, like Google
// Calendar and like the slot image that follows it in the chat onboarding: the
// days on a vertical hour axis, all-day entries under the day headings, the
// candidates in yellow with a checkbox each, and the host's other plans in grey
// for context. A checked candidate becomes free; those the classifier
// recommends as notes start checked, and the classifier's reason is the block's
// tooltip. Checking an entry that repeats checks the whole series. On a phone
// the week shows three days at a time (task 3.2). Confirm records only the
// candidates of the days the host has looked at, so nothing is freed unseen. Standalone, so the web setup's notes step, /app/notes and later
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

function rangeLabel(first: string, last: string, locale: Locale) {
  const format = new Intl.DateTimeFormat(tag(locale), { day: "numeric", month: "short", timeZone: "UTC" });
  return format.formatRange(new Date(`${first}T00:00:00Z`), new Date(`${last}T00:00:00Z`));
}

// Below Tailwind's sm breakpoint, where the seven days no longer fit, the week
// shows three days at a time.
const PHONE_QUERY = "(width < 640px)";

function subscribePhone(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePhone() {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

// What 확인 records: of the candidates the host has seen, the unanswered ones
// and the answers the host changed. An unticked candidate stays busy.
export function confirmedChoices(
  items: readonly NoteReviewItem[],
  seen: ReadonlySet<string>,
  choices: ReadonlyMap<string, "free" | "keep_busy">,
): NoteReviewChoice[] {
  return items
    .filter((item) => seen.has(item.key))
    .filter((item) => item.decision === null || choices.get(item.key) !== item.decision)
    .map((item) => ({
      decision: choices.get(item.key) ?? "keep_busy",
      key: item.key,
      ...(item.repeats ? { scope: "series" as const } : {}),
    }));
}

// A day column: its entries, or null while its week is still loading.
type Column = { readonly date: string; readonly day: WeekDay | null };


export function NoteReviewWeek({
  busy = false,
  confirmLabel,
  locale,
  onConfirm,
  onContinue,
  onDay,
  onWeek,
  phone: phoneOverride,
  review,
  startDay = null,
}: {
  readonly review: NoteReview;
  readonly locale: Locale;
  readonly busy?: boolean;
  readonly confirmLabel?: string;
  readonly onConfirm: (choices: NoteReviewChoice[]) => void;
  // With nothing left to check, a host of the review that moves on (the setup step).
  readonly onContinue?: () => void;
  // Loads the week of this Monday into review.week.
  readonly onWeek?: (start: string) => void;
  // The phone view's first day on screen, kept by the host across reloads.
  readonly startDay?: string | null;
  readonly onDay?: (date: string) => void;
  // Three days at a time or the whole week; by default from the screen width.
  readonly phone?: boolean;
}) {
  const t = NOTE_REVIEW_COPY[locale];
  const items = review.items;
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  const [choices, setChoices] = useState<ReadonlyMap<string, Choice>>(
    // The host's standing answer, or the classifier's recommendation.
    () => new Map(items.map((item) => [item.key, item.decision ?? (item.verdict === "note" ? "free" : "keep_busy")])),
  );
  const screenPhone = usePhone();
  const phone = phoneOverride ?? screenPhone;
  const week = review.week;

  // Every week loaded while this review is open, so three days that span two
  // weeks can be drawn from both.
  const [loaded, setLoaded] = useState<ReadonlyMap<string, NoteWeek>>(() => new Map(week ? [[week.start, week]] : []));
  useEffect(() => {
    if (!week) return;
    setLoaded((current) => (current.get(week.start) === week ? current : new Map(current).set(week.start, week)));
  }, [week]);
  const weeks = useMemo(() => (week && loaded.get(week.start) !== week ? new Map(loaded).set(week.start, week) : loaded), [loaded, week]);
  const layouts = useMemo(() => new Map([...weeks].map(([start, entry]) => [start, layoutWeek(entry, items)])), [weeks, items]);

  const [windowStart, setWindowStart] = useState(() => (week ? firstWindow(week, startDay) : ""));
  const moveWindow = (start: string) => {
    setWindowStart(start);
    onDay?.(start);
  };

  // The day columns on screen: the whole week, or three days on a phone.
  const columns: Column[] = useMemo(() => {
    if (!week) return [];
    if (!phone) return layouts.get(week.start)!.days.map((day) => ({ date: day.date, day }));
    return windowDates(windowStart).map((date) => ({
      date,
      day: layouts.get(mondayOf(date))?.days.find((entry) => entry.date === date) ?? null,
    }));
  }, [layouts, phone, week, windowStart]);
  const drawn = useMemo(() => columns.flatMap((column) => (column.day ? [column.day] : [])), [columns]);
  const hours = useMemo(() => hourRange(drawn), [drawn]);
  const visibleKeys = useMemo(() => candidateKeys(drawn), [drawn]);

  // The phone view asks once for each week its three days reach.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!phone || !windowStart) return;
    for (const start of windowWeeks(windowStart)) {
      if (weeks.has(start) || asked.current.has(start)) continue;
      asked.current.add(start);
      onWeek?.(start);
    }
  }, [onWeek, phone, weeks, windowStart]);

  // Candidates count as seen once a day they are on has been drawn.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => visibleKeys);
  useEffect(() => {
    setSeen((current) => {
      const missing = [...visibleKeys].filter((key) => !current.has(key));
      return missing.length === 0 ? current : new Set([...current, ...missing]);
    });
  }, [visibleKeys]);

  const choose = (key: string, choice: Choice) => setChoices((current) => new Map(current).set(key, choice));
  const anySeen = items.some((item) => seen.has(item.key));
  const confirm = () => onConfirm(confirmedChoices(items, seen, choices));

  const timeZone = week?.timezone ?? "UTC";
  const contextUnavailable = phone
    ? windowWeeks(windowStart).some((start) => weeks.get(start)?.contextUnavailable)
    : (week?.contextUnavailable ?? false);
  const lastShown = columns.at(-1)?.date ?? "";
  const previousDays = week && phone ? stepWindow(windowStart, -1, week.today, undefined) : null;
  const nextDays = week && phone ? stepWindow(windowStart, 1, week.today, weeks.get(mondayOf(lastShown))) : null;
  const gridColumns = phone ? "grid-cols-[56px_repeat(3,minmax(0,1fr))]" : "grid-cols-[56px_repeat(7,minmax(0,1fr))]";
  const height = (hours.lastHour - hours.firstHour) * HOUR_PX;

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
      ) : week && columns.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              className="text-sm font-semibold text-primary tabular-nums"
              data-note-range={phone ? `${windowStart}/${lastShown}` : undefined}
              data-note-week={phone ? undefined : week.start}
            >
              {rangeLabel(columns[0]!.date, lastShown, locale)}
            </p>
            <div className="flex items-center gap-1">
              <Button
                aria-label={phone ? t.previousDays : t.previousWeek}
                className="size-9 rounded-full"
                disabled={busy || (phone ? !previousDays : !week.previous)}
                onClick={() => {
                  if (phone) {
                    if (previousDays) moveWindow(previousDays);
                  } else if (week.previous) {
                    onWeek?.(week.previous);
                  }
                }}
                size="icon"
                type="button"
                variant="secondary"
              >
                <ChevronLeftIcon aria-hidden />
              </Button>
              <Button
                aria-label={phone ? t.nextDays : t.nextWeek}
                className="size-9 rounded-full"
                disabled={busy || (phone ? !nextDays : !week.next)}
                onClick={() => {
                  if (phone) {
                    if (nextDays) moveWindow(nextDays);
                  } else if (week.next) {
                    onWeek?.(week.next);
                  }
                }}
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
            <div className={cn("rounded-2xl bg-card", !phone && "overflow-x-auto")} data-note-days={columns.length} data-note-week-grid>
              <div className={cn("px-2 pt-3 pb-2", !phone && "min-w-[600px]")}>
                <div className={cn("grid gap-x-1.5", gridColumns)}>
                  <span />
                  {columns.map(({ date }) => {
                    const heading = dayHeading(date, locale);
                    const today = date === week.today;
                    return (
                      <div className="flex flex-col items-center pb-1.5" data-note-heading={date} key={date}>
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
                  {columns.map(({ date, day }) => (
                    <div className="flex min-h-7 flex-col gap-1 border-b border-secondary pb-1.5" data-note-all-day={date} key={date}>
                      {day?.allDay.map((block) => (
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

                <div className={cn("mt-1 grid gap-x-1.5", gridColumns)}>
                  <div className="relative" style={{ height }}>
                    {Array.from({ length: hours.lastHour - hours.firstHour }, (_, index) => hours.firstHour + index).map((hour) => (
                      <span
                        className="absolute right-2 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums"
                        key={hour}
                        style={{ top: (hour - hours.firstHour) * HOUR_PX }}
                      >
                        {hour === hours.firstHour ? "" : hourLabel(hour, locale)}
                      </span>
                    ))}
                  </div>
                  {columns.map(({ date, day }) => (
                    <div
                      aria-busy={day ? undefined : true}
                      className={cn("relative rounded-xl bg-background", !day && "animate-pulse")}
                      data-note-day={date}
                      key={date}
                      style={{ height }}
                    >
                      {day?.timed.map((block) => (
                        <div
                          className="absolute px-0.5"
                          key={block.id}
                          style={{
                            height: Math.max(((block.endMinute - block.startMinute) / 60) * HOUR_PX, 20),
                            left: `${(block.lane / block.lanes) * 100}%`,
                            top: ((block.startMinute - hours.firstHour * 60) / 60) * HOUR_PX,
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

          {contextUnavailable ? <p className="text-sm text-warning">{t.contextUnavailable}</p> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button className="min-h-11" disabled={busy || !anySeen} onClick={confirm} type="button">
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
  slotImageFollows = false,
}: {
  readonly review: NoteReview;
  readonly locale: Locale;
  readonly busy?: boolean;
  readonly exit: NoteReviewExit;
  readonly onBack: () => void;
  readonly onRetry?: (decisionId: string) => void;
  // The host's chat onboarding sends the open times after this 확인 (design 8).
  readonly slotImageFollows?: boolean;
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
      {slotImageFollows ? (
        <p className="text-xs text-muted-foreground" data-note-slot-image>
          {t.slotImageFollows}
        </p>
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
