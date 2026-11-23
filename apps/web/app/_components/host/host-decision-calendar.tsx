"use client";

import type { HostRequestView } from "@lib/contracts/host-request";
import type { DashboardData, DashboardEvent } from "@lib/server/host-dashboard";
import { useCallback, useRef, useState } from "react";
import { clockRange, dayIn, dayLabel, daysRange } from "@/app/_components/calendar/calendar-time";
import { type CalendarItem, type CalendarMark, WeekCalendar } from "@/app/_components/calendar/week-calendar";
import { sourceLabel } from "@/app/_components/host-dashboard-labels";

// The host's own week beside a request's decision card (calendar-views
// design 2, #147 and #379): the events the Dashboard shows (the Google
// Calendars the host chose, Find Me a Time meetings, sent requests), with the
// proposed time, a suggestion being written or checked and the open times of
// a private search marked over them. Marks follow the request as it changes.
// An open time, or a pointer pick on an empty part of a day, opens Request
// changes with that time filled in; nothing is shared until the host shares
// the suggestion.

const CLOSED = ["booked", "declined", "withdrawn", "expired", "cancelled"];

/** Whether the request has a time on screen to see against the host's week. */
export function showsDecisionCalendar(view: HostRequestView, editing: boolean) {
  if (view.sample || (CLOSED.includes(view.state) && !editing)) return false;
  return Boolean(editing || view.proposal || view.suggestion?.changes.start || view.evaluation?.candidates.some((candidate) => candidate.status === "offered"));
}

/** The marked times for a request: proposal, suggestion, the host's draft and open times. */
export function decisionMarks(view: HostRequestView, draftStart: string | null, onPick?: (start: string) => void): CalendarMark[] {
  const zone = view.hostTimezone;
  const minutes = view.proposal?.durationMinutes ?? view.details.durationMinutes ?? 30;
  const span = (start: string, length = minutes) => ({ end: new Date(Date.parse(start) + length * 60_000).toISOString(), start });
  const describe = (start: string, end: string) => `${dayLabel(dayIn(start, zone), "long")}, ${clockRange({ end, start }, zone)}`;
  const marks: CalendarMark[] = [];

  if (view.proposal) {
    const { end, start } = view.proposal;
    marks.push({ end, id: "proposal", srLabel: `Proposed time: ${describe(start, end)}`, start, tag: "Proposed", tone: "proposed" });
  }
  const suggested = view.suggestion && ["pending", "checking", "shared"].includes(view.suggestion.state) ? view.suggestion.changes.start : undefined;
  if (suggested && view.suggestion) {
    const at = span(suggested, view.suggestion.changes.durationMinutes ?? minutes);
    const tag = view.suggestion.state === "shared" ? "Shared suggestion" : "Your suggestion";
    marks.push({ ...at, id: "suggestion", srLabel: `${tag}: ${describe(at.start, at.end)}`, tag, tone: "draft" });
  }
  if (draftStart && draftStart !== suggested && draftStart !== view.proposal?.start) {
    const at = span(draftStart);
    marks.push({ ...at, id: "draft", srLabel: `New time you are suggesting: ${describe(at.start, at.end)}`, tag: "New time", tone: "draft" });
  }
  const taken = new Set(marks.map((mark) => mark.start));
  for (const candidate of view.evaluation?.candidates ?? []) {
    if (candidate.status !== "offered" || taken.has(candidate.start)) continue;
    marks.push({
      end: candidate.end,
      id: `candidate-${candidate.id}`,
      onSelect: onPick ? () => onPick(candidate.start) : undefined,
      srLabel: `${onPick ? "Suggest this open time" : "Open time"}: ${describe(candidate.start, candidate.end)}`,
      start: candidate.start,
      tone: "option",
    });
  }
  return marks;
}

/** A Dashboard event as a block on the host's week, leaving out this request's own copy. */
export function decisionItems(events: readonly DashboardEvent[], requestId: string): CalendarItem[] {
  return events
    .filter((event) => (event as { received?: { requestId?: string } }).received?.requestId !== requestId)
    .map((event) => ({
      allDay: event.allDay,
      end: event.end,
      id: event.id,
      srLabel: `${sourceLabel(event)}: ${event.title}`,
      start: event.start,
      title: event.title,
      tone: event.source,
    }));
}

export function HostDecisionCalendar({ draftStart, onPick, view }: { readonly draftStart: string | null; readonly onPick?: (start: string) => void; readonly view: HostRequestView }) {
  const [events, setEvents] = useState<readonly DashboardEvent[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [warning, setWarning] = useState<string | null>(null);
  const loaded = useRef(new Map<string, DashboardData>());
  const zone = view.hostTimezone;
  const marks = decisionMarks(view, draftStart, onPick);
  const focus = marks.find((mark) => mark.id === "draft") ?? marks.find((mark) => mark.id === "suggestion") ?? marks.find((mark) => mark.id === "proposal") ?? marks[0];
  const focusDay = dayIn(focus?.start ?? new Date().toISOString(), zone);

  // The Dashboard's own projection for the shown week, once per week per visit.
  const loadWeek = useCallback((days: readonly string[]) => {
    const { from, to } = daysRange(days);
    const key = `${from}|${to}`;
    const show = (data: DashboardData) => {
      setEvents(data.events);
      setWarning(data.googleWarning ?? null);
      setState("ready");
    };
    const cached = loaded.current.get(key);
    if (cached) return show(cached);
    setState("loading");
    void fetch(`/api/host/dashboard?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("dashboard");
        const data = (await response.json()) as DashboardData;
        loaded.current.set(key, data);
        show(data);
      })
      .catch(() => setState("failed"));
  }, []);

  return (
    <WeekCalendar
      focusDay={focusDay}
      heading={<h4 className="w-full text-sm font-semibold">Your calendar</h4>}
      items={decisionItems(events, view.requestId)}
      itemsLabel="Your events"
      label="Your calendar with this request's times"
      marks={marks}
      marksLabel="This request's times"
      onPick={onPick}
      onWeekChange={loadWeek}
      pickHint={onPick ? "Click an empty time to suggest it, or use Request changes." : undefined}
      status={
        state === "failed" ? (
          <p className="mb-2 text-sm text-muted-foreground" role="status">Your calendar could not be loaded. The marked times are still shown.</p>
        ) : state === "loading" ? (
          <p className="mb-2 text-sm text-muted-foreground" role="status">Loading your calendar…</p>
        ) : warning ? (
          <p className="mb-2 text-sm text-muted-foreground" role="status">{warning}</p>
        ) : null
      }
      timeZone={zone}
    />
  );
}
