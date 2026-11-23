"use client";

import type { RequesterCandidate } from "@lib/contracts/request";
import { zoneLabel } from "@lib/contracts/timezone";
import { useCallback, useMemo, useRef, useState } from "react";
import { clockRange, dayIn, dayLabel, daysRange } from "@/app/_components/calendar/calendar-time";
import { type CalendarItem, type CalendarMark, WeekCalendar } from "@/app/_components/calendar/week-calendar";

// The guest's Choose a time card as a calendar (calendar-views design 3, #374):
// the offered times as blocks in a week grid (one day with a day switcher on a
// phone), the details they share said once above it, and trip-dependent times
// drawn dashed. When the guest connected a calendar to this request, their
// own busy times are drawn under the times, as busy blocks without titles
// (design 4).

type BusySpan = { readonly start: string; readonly end: string; readonly allDay: boolean };

/** What every offered time shares, said once above the grid; null for a detail that differs. */
export function sharedDetails(candidates: readonly RequesterCandidate[], timeZone: string) {
  const first = candidates[0];
  if (!first) return null;
  const same = <T,>(pick: (candidate: RequesterCandidate) => T) => candidates.every((candidate) => pick(candidate) === pick(first));
  const place = (candidate: RequesterCandidate) => (candidate.mode === "online" ? "Online" : (candidate.location ?? "In person"));
  return {
    duration: same((candidate) => candidate.durationMinutes) ? `${first.durationMinutes} minutes` : null,
    place: same(place) ? place(first) : null,
    zone: zoneLabel(timeZone, new Date(first.start)),
  };
}

function detailsOf(candidate: RequesterCandidate, shared: ReturnType<typeof sharedDetails>) {
  return [
    shared?.duration ? null : `${candidate.durationMinutes} minutes`,
    shared?.place ? null : candidate.mode === "online" ? "Online" : (candidate.location ?? "In person"),
  ].filter(Boolean).join(" · ");
}

/** The accessible name of a time: its date and clock, and any detail not said above the grid. */
export function candidateLabel(candidate: RequesterCandidate, timeZone: string, shared: ReturnType<typeof sharedDetails>) {
  const extra = detailsOf(candidate, shared);
  return `${dayLabel(dayIn(candidate.start, timeZone), "long")}, ${clockRange(candidate, timeZone)}${extra ? `, ${extra}` : ""}`;
}

export function CandidateCalendar({
  bookingId,
  busy: busyDisabled,
  linkMissing,
  offered,
  onChoose,
  onTrip,
  timeZone,
  trips,
}: {
  readonly bookingId: string;
  readonly busy: boolean;
  readonly linkMissing: (candidate: RequesterCandidate) => boolean;
  readonly offered: readonly RequesterCandidate[];
  readonly onChoose: (candidate: RequesterCandidate) => void;
  readonly onTrip: (candidate: RequesterCandidate) => void;
  readonly timeZone: string;
  readonly trips: readonly RequesterCandidate[];
}) {
  const shared = useMemo(() => sharedDetails([...offered, ...trips], timeZone), [offered, trips, timeZone]);
  const [calendar, setCalendar] = useState<{ connected: boolean; busy: readonly BusySpan[]; failed: boolean }>({ busy: [], connected: false, failed: false });
  const loaded = useRef(new Map<string, readonly BusySpan[]>());
  // The grid opens at the earliest time, not the first in the search's spread order.
  const earliest = [...offered, ...trips].map((candidate) => candidate.start).sort()[0];
  const focusDay = dayIn(earliest ?? new Date().toISOString(), timeZone);
  // The week on screen: an answer for any other week is kept but not shown.
  const current = useRef<string | null>(null);

  // The guest's own busy times for the shown week, once per week per visit.
  const loadWeek = useCallback((days: readonly string[]) => {
    const { from, to } = daysRange(days);
    const key = `${from}|${to}`;
    current.current = key;
    const cached = loaded.current.get(key);
    if (cached) {
      setCalendar((current) => ({ ...current, busy: cached }));
      return;
    }
    void fetch(`/api/requests/${encodeURIComponent(bookingId)}/busy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=${encodeURIComponent(timeZone)}`, { cache: "no-store" })
      .then(async (response) => {
        // 503: a connected calendar that could not be read now.
        if (current.current !== key) return;
        if (response.status === 503) return setCalendar((current) => ({ ...current, busy: [], connected: true, failed: true }));
        if (!response.ok) return;
        const answer = (await response.json()) as { connected: boolean; busy: BusySpan[] };
        loaded.current.set(key, answer.busy);
        if (current.current === key) setCalendar({ busy: answer.busy, connected: answer.connected, failed: false });
      })
      .catch(() => {});
  }, [bookingId, timeZone]);

  const items: CalendarItem[] = calendar.busy.map((span, index) => ({
    allDay: span.allDay,
    end: span.end,
    id: `busy-${index}`,
    srLabel: span.allDay ? "Busy all day in your calendar" : `Busy in your calendar, ${clockRange(span, timeZone)}`,
    start: span.start,
    title: "Busy",
    tone: "busy",
  }));

  const marks: CalendarMark[] = [
    ...offered.map((candidate) => ({
      disabled: busyDisabled || linkMissing(candidate),
      end: candidate.end,
      id: candidate.id,
      onSelect: () => onChoose(candidate),
      srLabel: `Choose this time: ${candidateLabel(candidate, timeZone, shared)}`,
      start: candidate.start,
      tag: detailsOf(candidate, shared) || undefined,
      tone: "option" as const,
    })),
    ...trips.map((candidate) => ({
      end: candidate.end,
      id: candidate.id,
      onSelect: () => onTrip(candidate),
      srLabel: `Depends on your trip: ${candidateLabel(candidate, timeZone, shared)}. Estimate your trip`,
      start: candidate.start,
      tag: "Trip?",
      tone: "trip" as const,
    })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {shared ? (
        <p className="text-muted-foreground" data-testid="shared-details">
          {[shared.zone, shared.duration, shared.place].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <WeekCalendar
        focusDay={focusDay}
        items={items}
        itemsLabel="Busy in your calendar"
        label="Times on a calendar"
        marks={marks}
        marksLabel="Candidate times"
        onWeekChange={loadWeek}
        status={
          calendar.failed ? (
            <p className="mb-2 text-sm text-muted-foreground" role="status">Your calendar could not be shown right now. The times were still checked against it.</p>
          ) : calendar.connected ? (
            <p className="mb-2 text-sm text-muted-foreground">Striped blocks are busy times from your calendar. Only you see them.</p>
          ) : null
        }
        timeZone={timeZone}
      />
      {trips.length > 0 ? <p className="text-sm text-muted-foreground">Dashed times depend on your trip. Choose one to estimate it.</p> : null}
    </div>
  );
}
