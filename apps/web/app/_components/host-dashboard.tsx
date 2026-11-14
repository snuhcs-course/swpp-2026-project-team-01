"use client";

import type { DashboardData, DashboardEvent } from "@lib/server/host-dashboard";
import { ChevronLeftIcon, ChevronRightIcon, Clock3Icon, MapPinIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { HostSettingsDialog } from "./host-settings-dialog";
import { WorkspaceMenu } from "./workspace-menu";
import "./host-dashboard.css";

type View = "week" | "month";
const DAY = 86_400_000;
const HOURS = Array.from({ length: 11 }, (_, index) => index + 8);
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const dateAt = (key: string) => new Date(`${key}T12:00:00.000Z`);
const shift = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
const weekStart = (date: Date) => shift(date, -((date.getUTCDay() + 6) % 7));
const monthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
const prettyDay = (date: Date) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(date);

function periodDays(anchor: Date, view: View) {
  const first = view === "week" ? weekStart(anchor) : weekStart(monthStart(anchor));
  const count = view === "week" ? 7 : Math.ceil((new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 12)).getTime() - first.getTime() + DAY) / (7 * DAY)) * 7;
  return Array.from({ length: count }, (_, index) => shift(first, index));
}

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
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => periodDays(anchor, view), [anchor, view]);
  const range = `${new Date(days[0]!.getTime() - DAY).toISOString()}|${new Date(days.at(-1)!.getTime() + 2 * DAY).toISOString()}`;

  useEffect(() => {
    const controller = new AbortController();
    const [from, to] = range.split("|");
    setData(null);
    setError(null);
    void fetch(`/api/host/dashboard?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Your calendar could not be loaded. Try again later.");
        return response.json() as Promise<DashboardData>;
      })
      .then(setData)
      .catch(() => { if (!controller.signal.aborted) setError("Your calendar could not be loaded. Try again later."); });
    return () => controller.abort();
  }, [range]);

  const zone = data?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const items = useMemo(() => (data?.events ?? []).filter((event) => event.source === "google" ? showGoogle : showThyme), [data, showGoogle, showThyme]);
  const eventsFor = (key: string) => items.filter((event) => event.allDay ? event.start.slice(0, 10) <= key && key < event.end.slice(0, 10) : eventDay(event, zone) === key);
  const selectedEvents = eventsFor(selectedDay);
  const selected = selectedEvents.find((event) => event.id === selectedId) ?? selectedEvents[0] ?? null;
  const today = zonedDay(new Date().toISOString(), zone);

  function navigate(direction: number) {
    const next = view === "week" ? shift(anchor, direction * 7) : new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + direction, 1, 12));
    setAnchor(next);
    setSelectedDay(dayKey(view === "week" ? weekStart(next) : monthStart(next)));
    setSelectedId(null);
  }
  function goToday() { const now = dateAt(zonedDay(new Date().toISOString(), zone)); setAnchor(now); setSelectedDay(dayKey(now)); setSelectedId(null); }
  function selectEvent(event: DashboardEvent) { setSelectedDay(eventDay(event, zone)); setSelectedId(event.id); }

  return <div className="hd">
    <header className="hd-header">
      <h1 className="wordmark-lockup min-w-0">Find Me a Time</h1>
      <div className="hd-header-actions"><HostSettingsDialog /><WorkspaceMenu onSelectDashboard={() => router.push("/app")} onSelectSetup={() => router.push("/app?view=setup")} onSelectRequests={() => router.push("/app?view=requests")} onSelectImessage={() => router.push("/app?view=imessage")} /></div>
    </header>
    <div className="hd-layout">
      <main className="hd-main">
        <div className="hd-intro"><span className="hd-kicker">DASHBOARD</span><h2>Your week comes <em>together here.</em></h2><p>See your plans and the meetings Thyme booked for you, side by side.</p></div>
        <section className="hd-calendar" aria-label="Calendar">
          <div className="hd-toolbar"><div className="hd-period"><h3 aria-live="polite">{periodTitle(anchor, view)}</h3><button aria-label="Previous period" onClick={() => navigate(-1)} type="button"><ChevronLeftIcon /></button><button aria-label="Next period" onClick={() => navigate(1)} type="button"><ChevronRightIcon /></button><button className="hd-today" onClick={goToday} type="button">Today</button></div><div className="hd-view" role="group" aria-label="Calendar view"><button aria-pressed={view === "week"} onClick={() => setView("week")} type="button">Week</button><button aria-pressed={view === "month"} onClick={() => setView("month")} type="button">Month</button></div></div>
          <div className="hd-filters"><span>Show</span><label><input checked={showGoogle} onChange={(event) => setShowGoogle(event.target.checked)} type="checkbox" /><i className="hd-key hd-google" />Google Calendar</label><label><input checked={showThyme} onChange={(event) => setShowThyme(event.target.checked)} type="checkbox" /><i className="hd-key hd-thyme" />Find Me a Time meetings</label><small>{zone.replaceAll("_", " ")}</small></div>
          {error ? <p className="hd-notice" role="alert">{error}</p> : null}
          {data?.googleWarning ? <p className="hd-notice" role="status">{data.googleWarning} Thyme meetings are still shown.</p> : null}
          {!data && !error ? <p className="hd-loading" role="status">Loading your calendar…</p> : view === "week" ?
            <div className="hd-week-scroll"><div className="hd-week"><div className="hd-spacer" />{days.map((date) => <button className={`hd-day-head ${dayKey(date) === today ? "hd-current" : ""}`} key={dayKey(date)} onClick={() => { setSelectedDay(dayKey(date)); setSelectedId(null); }} type="button"><span>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date)}</span><strong>{date.getUTCDate()}</strong></button>)}<div className="hd-time-axis">{HOURS.map((hour) => <span key={hour}>{String(hour).padStart(2, "0")}:00</span>)}</div>{days.map((date) => {
              const key = dayKey(date), dayItems = eventsFor(key);
              return <div className={`hd-day-column ${key === selectedDay ? "hd-selected-day" : ""}`} key={key} onClick={() => { setSelectedDay(key); setSelectedId(null); }}>
                {dayItems.filter((event) => event.allDay).slice(0, 2).map((event) => <button className={`hd-event hd-${event.source} hd-all-day`} key={event.id} onClick={(click) => { click.stopPropagation(); selectEvent(event); }} type="button">{event.title}</button>)}
                {dayItems.filter((event) => !event.allDay).map((event) => { const start = minutes(event.start, zone), end = minutes(event.end, zone); if (end <= 480 || start >= 1140) return null; const top = Math.max(start, 480) - 480, height = Math.max(Math.min(end, 1140) - Math.max(start, 480), 28); return <button aria-label={`${event.source === "thyme" ? "Find Me a Time meeting" : "Google Calendar event"}: ${event.title}, ${eventTime(event, zone)}`} className={`hd-event hd-${event.source}`} key={event.id} onClick={(click) => { click.stopPropagation(); selectEvent(event); }} style={{ top: top + 38, height: height - 6 }} type="button"><strong>{eventTime(event, zone)}</strong><span>{event.title}</span><small>{event.source === "thyme" ? "✦ Thyme meeting" : "▣ Google event"}</small></button>; })}
              </div>;
            })}</div></div> :
            <div className="hd-month">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => <span className="hd-month-head" key={name}>{name}</span>)}{days.map((date) => { const key = dayKey(date), dayItems = eventsFor(key); return <div className={`hd-month-day ${date.getUTCMonth() !== anchor.getUTCMonth() ? "hd-outside" : ""} ${key === selectedDay ? "hd-selected-day" : ""}`} key={key} onClick={() => { setSelectedDay(key); setSelectedId(null); }}><strong>{date.getUTCDate()}</strong>{dayItems.slice(0, 3).map((event) => <button className={`hd-month-event hd-${event.source}`} key={event.id} onClick={(click) => { click.stopPropagation(); selectEvent(event); }} title={event.title} type="button">{event.allDay ? "" : `${eventTime(event, zone).split(" – ")[0]} `}{event.title}</button>)}{dayItems.length > 3 ? <small>+{dayItems.length - 3} more</small> : null}</div>; })}</div>}
        </section>
      </main>
      <aside className="hd-detail" aria-label="Selected day and event details"><span className="hd-kicker">SELECTED DAY</span><h2>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(dateAt(selectedDay))}</h2><p>{selectedEvents.length} {selectedEvents.length === 1 ? "event" : "events"}</p><div className="hd-agenda">{selectedEvents.map((event) => <button aria-pressed={selected?.id === event.id} className={`hd-agenda-item hd-${event.source}`} key={event.id} onClick={() => selectEvent(event)} type="button"><small>{eventTime(event, zone)} · {event.source === "thyme" ? "Thyme meeting" : "Google Calendar"}</small><strong>{event.title}</strong></button>)}{selectedEvents.length === 0 ? <span className="hd-empty">No events to show for this day.</span> : null}</div><div className="hd-detail-rule" /><span className="hd-detail-label">EVENT DETAILS</span>{selected ? <><span className={`hd-source hd-${selected.source}`}>{selected.source === "thyme" ? "✦ Find Me a Time meeting" : "▣ Google Calendar event"}</span><h3>{selected.title}</h3><p className="hd-detail-row"><Clock3Icon />{selected.allDay ? "All day" : eventTime(selected, zone)}</p>{selected.location ? <p className="hd-detail-row"><MapPinIcon />{selected.location}</p> : null}<p className="hd-detail-note">{selected.source === "thyme" ? "Booked by Thyme. This meeting is shown only once, even if it also appears in Google Calendar." : "From your private Google Calendar. Only you can see its details here."}</p></> : <p className="hd-empty">Select a day or event to see details.</p>}</aside>
    </div>
  </div>;
}
