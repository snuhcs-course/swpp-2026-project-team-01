"use client";

import { localDate } from "@lib/contracts/timezone";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { addDays, clockRange, dayIn, dayLabel, overlaps, pickedInstant, placement, type Span, visibleHours, weekOf, weekTitle } from "./calendar-time";
import "./week-calendar.css";

// One week of a calendar, or one day on a phone, with times marked over it
// (calendar-views design 1). It has the host Dashboard's Week view geometry
// (Monday-first columns, hour rows, blocks placed by local time) and its
// source colours, so the host's calendar beside a decision, the guest's
// Choose a time grid and the Dashboard read the same way.
//
// Layout follows cal.diy's booker week view (apps/web/modules/bookings/
// components/LargeCalendar.tsx, ae027bb7): existing events are drawn as
// blocks, the times on offer are drawn over them, and an overlay calendar is
// busy time only.
//
// Screen readers get two lists in time order: the events, and the marked
// times. A marked time with an action is a button whose name says the date,
// the time and the action. Picking an empty time is a pointer shortcut; each
// caller also has a form for it.

export type CalendarItem = Span & {
  readonly id: string;
  readonly allDay?: boolean;
  // The text in the block, and the full accessible text of the event.
  readonly title: string;
  readonly srLabel: string;
  // A colour role: a Dashboard source (google, thyme, sent, received) or busy.
  readonly tone: string;
};

export type MarkTone = "proposed" | "option" | "draft" | "trip";

export type CalendarMark = Span & {
  readonly id: string;
  // A short tag above the time ("Proposed", "Your suggestion").
  readonly tag?: string;
  readonly srLabel: string;
  readonly tone: MarkTone;
  readonly onSelect?: () => void;
  readonly disabled?: boolean;
};

export const HOUR_PX = 48;
const ALL_DAY_PX = 26;
const NARROW_QUERY = "(max-width: 639px)";

function subscribe(change: () => void) {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

/** Whether the screen is phone width; false while rendering on the server. */
export function useNarrow() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(NARROW_QUERY).matches, () => false);
}

export type WeekCalendarProps = {
  // The region's accessible name, and the visible heading above the grid.
  readonly label: string;
  readonly heading?: ReactNode;
  readonly timeZone: string;
  // The day to open at; when it changes the calendar moves there.
  readonly focusDay: string;
  readonly items: readonly CalendarItem[];
  readonly itemsLabel: string;
  readonly marks: readonly CalendarMark[];
  readonly marksLabel: string;
  // Called with the week's seven days whenever the shown week changes, so the
  // caller can load its events.
  readonly onWeekChange?: (days: readonly string[]) => void;
  // A pointer pick on an empty part of a day: the picked quarter-hour.
  readonly onPick?: (start: string) => void;
  readonly pickHint?: string;
  // Loading and notice lines, shown above the grid.
  readonly status?: ReactNode;
  // Force the one-day view (for tests and narrow containers).
  readonly narrow?: boolean;
};

export function WeekCalendar(props: WeekCalendarProps) {
  const { focusDay, items, label, marks, onWeekChange, timeZone } = props;
  const narrowScreen = useNarrow();
  const narrow = props.narrow ?? narrowScreen;
  const [day, setDay] = useState(focusDay);

  // A new proposal or page of times moves the calendar to it.
  useEffect(() => setDay(focusDay), [focusDay]);

  const week = weekOf(day);
  const weekKey = week[0]!;
  useEffect(() => {
    onWeekChange?.(weekOf(weekKey));
  }, [weekKey, onWeekChange]);

  const shown = narrow ? [day] : week;
  const hours = visibleHours(marks, shown, timeZone);
  const rows = hours[1] - hours[0];
  const timed = items.filter((item) => !item.allDay);
  const allDay = items.filter((item) => item.allDay);
  const allDayShown = allDay.some((item) => shown.some((key) => allDayOn(item, key)));
  const band = allDayShown ? ALL_DAY_PX : 0;
  const today = localDate(new Date(), timeZone);
  const marksOn = (key: string) => marks.filter((mark) => dayIn(mark.start, timeZone) === key).length;
  const step = narrow ? 1 : 7;

  function pick(event: MouseEvent<HTMLDivElement>, key: string) {
    if (!props.onPick) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = ((event.clientY - rect.top - band) / HOUR_PX) * 60;
    if (offset < 0) return;
    const start = pickedInstant(key, offset, hours, timeZone);
    if (start) props.onPick(start);
  }

  const column = (key: string) => shown.indexOf(key);
  const position = (index: number) => ({ left: `${(index * 100) / shown.length}%`, width: `${100 / shown.length}%` });
  const sortedMarks = [...marks].sort((a, b) => a.start.localeCompare(b.start));
  const sortedItems = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const elsewhere = marks.filter((mark) => !shown.includes(dayIn(mark.start, timeZone))).length;

  return (
    <section aria-label={label} className="cw" data-narrow={narrow ? "" : undefined}>
      <div className="cw-toolbar">
        {props.heading ?? null}
        <p aria-live="polite" className="cw-title">{narrow ? dayLabel(day, "long") : weekTitle(week)}</p>
        <div className="cw-nav">
          <button aria-label={narrow ? "Previous day" : "Previous week"} onClick={() => setDay(addDays(day, -step))} type="button"><ChevronLeftIcon aria-hidden /></button>
          <button aria-label={narrow ? "Next day" : "Next week"} onClick={() => setDay(addDays(day, step))} type="button"><ChevronRightIcon aria-hidden /></button>
        </div>
      </div>
      {narrow ? (
        <div aria-label="Day" className="cw-strip" role="group">
          {week.map((key) => {
            const count = marksOn(key);
            return (
              <button aria-current={key === today ? "date" : undefined} aria-label={`${dayLabel(key, "long")}${count > 0 ? `, ${count} ${count === 1 ? "time" : "times"}` : ""}`} aria-pressed={key === day} key={key} onClick={() => setDay(key)} type="button">
                <span>{dayLabel(key).split(" ")[0]}</span>
                <strong>{dayLabel(key).split(" ")[1]}</strong>
                <i aria-hidden className={count > 0 ? "cw-dot" : "cw-dot cw-none"} />
              </button>
            );
          })}
        </div>
      ) : null}
      {props.status ?? null}
      <div className="cw-grid" style={{ gridTemplateColumns: `var(--cw-axis) repeat(${shown.length}, minmax(0, 1fr))` }}>
        {narrow ? null : (
          <>
            <span aria-hidden className="cw-corner" />
            {shown.map((key) => (
              <span aria-current={key === today ? "date" : undefined} aria-hidden className="cw-day-head" key={key}>
                <span>{dayLabel(key).split(" ")[0]}</span>
                <strong>{dayLabel(key).split(" ")[1]}</strong>
              </span>
            ))}
          </>
        )}
        <div aria-hidden className="cw-axis" style={{ paddingTop: band, height: rows * HOUR_PX + band }}>
          {Array.from({ length: rows }, (_, index) => <span key={index}>{String(hours[0] + index).padStart(2, "0")}:00</span>)}
        </div>
        <div className="cw-body" style={{ gridColumn: `2 / span ${shown.length}`, height: rows * HOUR_PX + band }}>
          {shown.map((key, index) => (
            // A pointer shortcut only: the caller's form is the keyboard path.
            <div aria-hidden className={`cw-column${props.onPick ? " cw-pickable" : ""}${key === today ? " cw-today" : ""}`} key={key} onClick={(event) => pick(event, key)} style={{ ...position(index), backgroundPosition: `0 ${band}px`, backgroundSize: `100% ${HOUR_PX}px` }} />
          ))}
          {sortedItems.length > 0 ? (
            <ul aria-label={props.itemsLabel} className="cw-layer">
              {sortedItems.flatMap((item) => {
                if (item.allDay) {
                  return shown.filter((key) => allDayOn(item, key)).slice(0, 1).map((key) => (
                    <li className={`cw-item cw-${item.tone} cw-all-day`} key={`${item.id}:${key}`} style={{ ...position(column(key)), top: 2, height: ALL_DAY_PX - 4 }}>
                      <span className="sr-only">{item.srLabel}</span>
                      <span aria-hidden>{item.title}</span>
                    </li>
                  ));
                }
                return shown.flatMap((key) => {
                  const at = placement(item, key, timeZone, hours);
                  if (!at) return [];
                  const height = (at.height / 60) * HOUR_PX;
                  return [
                    <li className={`cw-item cw-${item.tone}${height < 30 ? " cw-short" : ""}`} key={`${item.id}:${key}`} style={{ ...position(column(key)), top: band + (at.top / 60) * HOUR_PX + 1, height: height - 2 }}>
                      <span className="sr-only">{item.srLabel}</span>
                      <span aria-hidden className="cw-item-text">{height < 30 ? item.title : <><strong>{clockRange(item, timeZone)}</strong> {item.title}</>}</span>
                    </li>,
                  ];
                });
              })}
            </ul>
          ) : null}
          {sortedMarks.length > 0 ? (
            <ul aria-label={props.marksLabel} className="cw-layer cw-marks">
              {sortedMarks.flatMap((mark) => {
                const key = dayIn(mark.start, timeZone);
                const at = shown.includes(key) ? placement(mark, key, timeZone, hours) : null;
                // A time on another day is counted under the grid instead.
                if (!at) return [];
                const covered = timed.some((item) => overlaps(item, mark));
                const height = (at.height / 60) * HOUR_PX;
                return [
                  <li className={`cw-mark cw-${mark.tone}${covered ? " cw-inset" : ""}${height < 34 ? " cw-short" : ""}`} key={mark.id} style={{ ...position(column(key)), top: band + (at.top / 60) * HOUR_PX + 1, height: Math.max(height - 2, 22) }}>
                    <MarkBody mark={mark} timeZone={timeZone} />
                  </li>,
                ];
              })}
            </ul>
          ) : null}
        </div>
      </div>
      {elsewhere > 0 ? <p className="cw-hint">{elsewhere} more {elsewhere === 1 ? "time" : "times"} on other {narrow ? "days" : "weeks"}. Use {narrow ? "the days above or Next day" : "Next week and Previous week"} to see {elsewhere === 1 ? "it" : "them"}.</p> : null}
      {props.onPick && props.pickHint ? <p className="cw-hint">{props.pickHint}</p> : null}
    </section>
  );
}

function MarkBody({ mark, timeZone }: { readonly mark: CalendarMark; readonly timeZone: string }) {
  const content = (
    <>
      {mark.tag ? <span className="cw-tag">{mark.tag}</span> : null}
      <strong>{clockRange(mark, timeZone)}</strong>
    </>
  );
  if (!mark.onSelect) {
    return <><span className="sr-only">{mark.srLabel}</span><span aria-hidden className="cw-mark-body">{content}</span></>;
  }
  return (
    <button aria-label={mark.srLabel} className="cw-mark-body" disabled={mark.disabled} onClick={mark.onSelect} type="button">
      {content}
    </button>
  );
}

function allDayOn(item: CalendarItem, day: string) {
  return item.start.slice(0, 10) <= day && day < item.end.slice(0, 10);
}
