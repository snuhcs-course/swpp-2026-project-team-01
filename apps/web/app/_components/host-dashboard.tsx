"use client";

import type { DashboardData, DashboardEvent } from "@lib/server/host-dashboard";
import { ChevronLeftIcon, ChevronRightIcon, Clock3Icon, MapPinIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { WeeklyWindow } from "@lib/contracts/setup";
import { createDashboardCache, dateAt, fetchDashboardRange, monthStart, periodDays, periodRange, shift, shiftPeriod, type View, weekHours, weekStart } from "./host-dashboard-data";
import { blockLabel, detailNote, detailSource, meetingFacts, meetingRequestPath, receivedFacts, sentState, sourceLabel } from "./host-dashboard-labels";
import { HostSettingsDialog } from "./host-settings-dialog";
import { WorkspaceMenu } from "./workspace-menu";
import { HostWordmark } from "./host-wordmark";
import "./host-dashboard.css";

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const LOAD_ERROR = "Your calendar could not be loaded. Try again later.";

function zonedDay(iso: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const value = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function eventDay(event: DashboardEvent, zone: string) { return event.allDay ? event.start.slice(0, 10) : zonedDay(event.start, zone); }

function minutes(iso: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

function eventTime(event: DashboardEvent, zone: string) {
  if (event.allDay) return "All day";
  const format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  return `${format.format(new Date(event.start))} – ${format.format(new Date(event.end))}`;
}

// The day headers sit in the sticky calendar head, outside the week grid's
// horizontal scroller, so each follows the other's sideways scroll.
function alignScroll(from: HTMLElement, to: HTMLElement | null) {
  if (to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
}

function periodTitle(anchor: Date, view: View) {
  if (view === "month") return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(anchor);
  const start = weekStart(anchor), end = shift(start, 6);
  const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${month.format(start)} ${start.getUTCDate()}–${end.getUTCDate()}, ${start.getUTCFullYear()}`
    : `${month.format(start)} ${start.getUTCDate()} – ${month.format(end)} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
}

export function HostDashboard() {
  const router = useRouter();
  const [anchor, setAnchor] = useState(() => dateAt(localToday()));
  const [view, setView] = useState<View>("week");
  const [selectedDay, setSelectedDay] = useState(localToday);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGoogle, setShowGoogle] = useState(true);
  const [showThyme, setShowThyme] = useState(true);
  const [showSent, setShowSent] = useState(true);
  const [showReceived, setShowReceived] = useState(true);
  // Loaded periods for this visit (#365): the grid stays while a period loads,
  // a period seen before shows at once, and the periods either side load ahead.
  const [cache] = useState(() => createDashboardCache(fetchDashboardRange));
  const [, loaded] = useReducer((count: number) => count + 1, 0);
  const [failed, setFailed] = useState<string | null>(null);
  const [lastZone, setLastZone] = useState<string | null>(null);
  const [lastWindows, setLastWindows] = useState<readonly WeeklyWindow[]>([]);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const daysRef = useRef<HTMLDivElement>(null);
  const weekScrollRef = useRef<HTMLDivElement>(null);

  // On a narrow screen only the toolbar and the day headers stay at the top, so
  // the day headers stick just under the toolbar, whose height can wrap.
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => toolbar.parentElement?.parentElement?.style.setProperty("--hd-toolbar-h", `${toolbar.offsetHeight}px`));
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);
  const days = useMemo(() => periodDays(anchor, view), [anchor, view]);
  const range = periodRange(anchor, view);
  const previous = periodRange(shiftPeriod(anchor, view, -1), view);
  const next = periodRange(shiftPeriod(anchor, view, 1), view);

  useEffect(() => {
    let live = true;
    setFailed(null);
    // A period already shown refreshes behind its cached events; only its own
    // answer, read back by range, ever reaches the screen.
    cache.load(range)
      .then((answer) => { if (live) { setLastZone(answer.timeZone || null); setLastWindows(answer.weeklyWindows ?? []); loaded(); } })
      .catch(() => { if (live) setFailed(range); });
    cache.prefetch(previous);
    cache.prefetch(next);
    return () => { live = false; };
  }, [cache, range, previous, next]);

  const data: DashboardData | null = cache.peek(range);
  const error = !data && failed === range ? LOAD_ERROR : null;
  const loading = !data && !error;
  const zone = data?.timeZone || lastZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const items = useMemo(() => (data?.events ?? []).filter((event) => event.source === "google" ? showGoogle : event.source === "sent" ? showSent : event.source === "received" ? showReceived : showThyme), [data, showGoogle, showReceived, showSent, showThyme]);
  const eventsFor = (key: string) => items.filter((event) => event.allDay ? event.start.slice(0, 10) <= key && key < event.end.slice(0, 10) : eventDay(event, zone) === key);
  const selectedEvents = eventsFor(selectedDay);
  const selected = selectedEvents.find((event) => event.id === selectedId) ?? selectedEvents[0] ?? null;
  const today = zonedDay(new Date().toISOString(), zone);
  // The week grid covers the host's open hours and every timed event of the
  // week, whatever the source filters hide, so toggling one never moves it.
  const weekKeys = new Set(days.map(dayKey));
  const hours = weekHours(data?.weeklyWindows ?? lastWindows, (data?.events ?? [])
    .filter((event) => !event.allDay && weekKeys.has(eventDay(event, zone)))
    .map((event) => ({ start: minutes(event.start, zone), end: minutes(event.end, zone) })));
  const gridStart = hours.start * 60, gridEnd = hours.end * 60;
  const hourLabels = Array.from({ length: hours.end - hours.start }, (_, index) => hours.start + index);

  function navigate(direction: number) {
    const target = shiftPeriod(anchor, view, direction);
    setAnchor(target);
    setSelectedDay(dayKey(view === "week" ? weekStart(target) : monthStart(target)));
    setSelectedId(null);
  }
  function goToday() { const now = dateAt(zonedDay(new Date().toISOString(), zone)); setAnchor(now); setSelectedDay(dayKey(now)); setSelectedId(null); }
  function selectEvent(event: DashboardEvent) { setSelectedDay(eventDay(event, zone)); setSelectedId(event.id); }

  return <div className="hd">
    <header className="hd-header">
      <HostWordmark className="min-w-0" />
      <div className="hd-header-actions"><HostSettingsDialog /><WorkspaceMenu onSelectRequests={() => router.push("/app?view=requests")} /></div>
    </header>
    <div className="hd-layout">
      <main className="hd-main">
        <div className="hd-intro"><h2>Your week comes <em>together here.</em></h2><p>See your plans and the meetings Thyme booked for you, side by side.</p></div>
        <section className="hd-calendar" aria-label="Calendar">
          <div className="hd-calendar-head"><div className="hd-toolbar" ref={toolbarRef}><div className="hd-period"><h3 aria-live="polite">{periodTitle(anchor, view)}</h3><button aria-label="Previous period" onClick={() => navigate(-1)} type="button"><ChevronLeftIcon /></button><button aria-label="Next period" onClick={() => navigate(1)} type="button"><ChevronRightIcon /></button><button className="hd-today" onClick={goToday} type="button">Today</button></div><div className="hd-view" role="group" aria-label="Calendar view"><button aria-pressed={view === "week"} onClick={() => setView("week")} type="button">Week</button><button aria-pressed={view === "month"} onClick={() => setView("month")} type="button">Month</button></div></div>
          <div className="hd-filters"><span>Show</span><label><input checked={showGoogle} onChange={(event) => setShowGoogle(event.target.checked)} type="checkbox" /><i className="hd-key hd-google" />Google Calendar</label><label><input checked={showThyme} onChange={(event) => setShowThyme(event.target.checked)} type="checkbox" /><i className="hd-key hd-thyme" />Find Me a Time meetings</label><label><input checked={showSent} onChange={(event) => setShowSent(event.target.checked)} type="checkbox" /><i className="hd-key hd-sent" />Sent requests</label><label><input checked={showReceived} onChange={(event) => setShowReceived(event.target.checked)} type="checkbox" /><i className="hd-key hd-received" />Requests to decide</label><small>{zone.replaceAll("_", " ")}</small></div>
          {view === "week" ? <div className="hd-days" onScroll={(scroll) => alignScroll(scroll.currentTarget, weekScrollRef.current)} ref={daysRef}><div className="hd-days-row"><div className="hd-spacer" />{days.map((date) => <button className={`hd-day-head ${dayKey(date) === today ? "hd-current" : ""}`} key={dayKey(date)} onClick={() => { setSelectedDay(dayKey(date)); setSelectedId(null); }} type="button"><span>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date)}</span><strong>{date.getUTCDate()}</strong></button>)}</div></div> : null}</div>
          {error ? <p className="hd-notice" role="alert">{error}</p> : null}
          {data?.googleWarning ? <p className="hd-notice" role="status">{data.googleWarning} Find Me a Time meetings and requests are still shown.</p> : null}
          <div className="hd-grid" data-view={view}><p className={loading ? "hd-grid-loading" : "sr-only"} role="status">{loading ? "Loading events…" : ""}</p>{view === "week" ?
            <div className="hd-week-scroll" onScroll={(scroll) => alignScroll(scroll.currentTarget, daysRef.current)} ref={weekScrollRef}><div className="hd-week" style={{ gridTemplateRows: `${35 + hourLabels.length * 60}px` }}><div className="hd-time-axis">{hourLabels.map((hour) => <span key={hour}>{String(hour).padStart(2, "0")}:00</span>)}</div>{days.map((date) => {
              const key = dayKey(date), dayItems = eventsFor(key);
              return <div className={`hd-day-column ${key === selectedDay ? "hd-selected-day" : ""}`} key={key} onClick={() => { setSelectedDay(key); setSelectedId(null); }}>
                {dayItems.filter((event) => event.allDay).slice(0, 2).map((event) => <button className={`hd-event hd-${event.source} hd-all-day`} key={event.id} onClick={(click) => { click.stopPropagation(); selectEvent(event); }} type="button">{event.title}</button>)}
                {dayItems.filter((event) => !event.allDay).map((event) => { const start = minutes(event.start, zone), endAt = minutes(event.end, zone), end = endAt > start ? endAt : 1440; if (end <= gridStart || start >= gridEnd) return null; const top = Math.max(start, gridStart) - gridStart, height = Math.max(Math.min(end, gridEnd) - Math.max(start, gridStart), 28); const compact = height < 45; return <button aria-label={`${sourceLabel(event)}: ${event.title}, ${eventTime(event, zone)}${event.meeting ? `, with ${event.meeting.guest.name}` : ""}${event.source === "sent" ? `, ${sentState(event)}` : ""}${event.source === "received" && event.received ? `, from ${event.received.requesterName}` : ""}`} className={`hd-event hd-${event.source}${compact ? " hd-compact" : ""}`} key={event.id} onClick={(click) => { click.stopPropagation(); selectEvent(event); }} style={{ top: top + 38, height: height - 6 }} type="button"><strong>{eventTime(event, zone)}</strong><span>{compact ? blockLabel(event) : event.title}</span>{compact ? null : <small>{event.source === "sent" ? `Sent · ${sentState(event)}` : event.source === "received" ? `◇ ${blockLabel(event)} · To decide` : event.source === "thyme" ? `✦ ${event.meeting ? `With ${event.meeting.guest.name}` : "Thyme meeting"}` : "▣ Google event"}</small>}</button>; })}
              </div>;
            })}</div></div> :
            <div className="hd-month">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => <span className="hd-month-head" key={name}>{name}</span>)}{days.map((date) => { const key = dayKey(date), dayItems = eventsFor(key); return <div className={`hd-month-day ${date.getUTCMonth() !== anchor.getUTCMonth() ? "hd-outside" : ""} ${key === selectedDay ? "hd-selected-day" : ""}`} key={key} onClick={() => { setSelectedDay(key); setSelectedId(null); }}><strong>{date.getUTCDate()}</strong>{dayItems.slice(0, 3).map((event) => <button className={`hd-month-event hd-${event.source}`} key={event.id} onClick={(click) => { click.stopPropagation(); selectEvent(event); }} title={event.title} type="button">{event.allDay ? "" : `${eventTime(event, zone).split(" – ")[0]} `}{event.title}</button>)}{dayItems.length > 3 ? <small>+{dayItems.length - 3} more</small> : null}</div>; })}</div>}</div>
        </section>
      </main>
      <aside className="hd-detail" aria-label="Selected day and event details"><span className="hd-kicker">SELECTED DAY</span><h2>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(dateAt(selectedDay))}</h2><p>{selectedEvents.length} {selectedEvents.length === 1 ? "event" : "events"}</p><div className="hd-agenda">{selectedEvents.map((event) => <button aria-pressed={selected?.id === event.id} className={`hd-agenda-item hd-${event.source}`} key={event.id} onClick={() => selectEvent(event)} type="button"><small>{eventTime(event, zone)} · {detailSource(event)}</small><strong>{event.title}</strong></button>)}{selectedEvents.length === 0 ? <span className="hd-empty">No events to show for this day.</span> : null}</div><div className="hd-detail-rule" /><span className="hd-detail-label">EVENT DETAILS</span>{selected ? <><span className={`hd-source hd-${selected.source}`}>{detailSource(selected)}</span><h3>{selected.title}</h3><EventFacts event={selected} zone={zone} /><p className="hd-detail-note">{detailNote(selected)}</p></> : <p className="hd-empty">Select a day or event to see details.</p>}</aside>
    </div>
  </div>;
}

// A Find Me a Time meeting shows the details the host approved and a way back
// to its request; other events show their time and any location.
function EventFacts({ event, zone }: { readonly event: DashboardEvent; readonly zone: string }) {
  const when = event.allDay ? "All day" : eventTime(event, zone);
  const facts = event.source === "received" ? receivedFacts(event, when) : meetingFacts(event, when);
  const requestPath = meetingRequestPath(event);
  if (facts.length === 0) {
    return <><p className="hd-detail-row"><Clock3Icon />{when}</p>{event.location ? <p className="hd-detail-row"><MapPinIcon />{event.location}</p> : null}</>;
  }
  return <>
    <dl className="hd-facts">{facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.href ? <a href={fact.href} rel="noreferrer" target="_blank">{fact.value}</a> : fact.value}</dd></div>)}</dl>
    {requestPath ? <Link className="hd-open-request" href={requestPath}>Open request</Link> : null}
  </>;
}
