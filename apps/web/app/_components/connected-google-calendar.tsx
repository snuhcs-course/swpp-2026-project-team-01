"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { browserTimeZone, readSetupState, runSetupCommand, type SetupState } from "@/lib/setup/client";

type Calendar = NonNullable<SetupState["calendar"]["calendars"]>[number];

export function ConnectedGoogleCalendar() {
  const [state, setState] = useState<SetupState | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [booking, setBooking] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function refresh() {
    const next = await readSetupState(browserTimeZone(), { calendars: true });
    const list = next.calendar.calendars ?? [];
    const savedConflicts = next.roles?.conflictCalendars.map((calendar) => calendar.id) ?? [];
    const savedBooking = next.roles?.bookingCalendar.id ?? "";
    const suggested = next.calendar.recommendations;
    setState(next);
    setConflicts(savedConflicts.length ? savedConflicts : suggested?.conflict.map((calendar) => calendar.id) ?? []);
    setBooking(savedBooking || suggested?.booking?.id || list.find((calendar) => calendar.accessRole === "owner" || calendar.accessRole === "writer")?.id || "");
  }

  useEffect(() => { void refresh().catch(() => setNotice("Google Calendar could not be loaded.")); }, []);

  async function save() {
    if (!state || !booking || conflicts.length === 0) return;
    setBusy(true); setNotice("");
    const result = await runSetupCommand({
      expectedRevision: state.roles?.revision ?? 0,
      input: { bookingCalendarId: booking, conflictCalendarIds: conflicts },
      operation: "setup.save_calendar_roles",
      retryKey: crypto.randomUUID(),
    });
    setBusy(false);
    if (result.kind !== "ok") { setNotice(result.message); await refresh().catch(() => undefined); return; }
    setNotice("Calendar choices saved for review. Guests keep using your current settings until you confirm the update in setup.");
    await refresh();
  }

  async function disconnect() {
    setBusy(true); setNotice("");
    const response = await fetch("/api/host/google-calendar", { method: "DELETE" });
    setBusy(false);
    if (!response.ok) { setNotice("Google Calendar could not be disconnected. Try again."); return; }
    setConfirmDisconnect(false);
    setNotice("Google Calendar disconnected. New requests are paused; existing requests, bookings and Calendar events stay in place. Reconnect and complete setup to continue calendar-dependent work.");
    await refresh().catch(() => setState(null));
  }

  const calendars: readonly Calendar[] = state?.calendar.calendars ?? [];
  return (
    <section aria-labelledby="connected-google-calendar-heading" className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold" id="connected-google-calendar-heading">Google Calendar</h3>
        <p className="mt-1 text-sm text-muted-foreground">Choose which calendars to check and where new bookings go.</p>
      </div>
      {!state ? <p className="text-sm text-muted-foreground" role="status">Loading calendars…</p> : state.calendar.connected ? (
        <>
          <p className="text-sm">Connected as <span className="break-all font-medium">{state.account.googleEmail ?? "Google account"}</span></p>
          {state.calendar.error ? <p className="text-sm text-destructive">Calendar list unavailable. Reconnect Google Calendar and try again.</p> : (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Check for conflicts</legend>
                {calendars.map((calendar) => <label className="flex items-center gap-2 text-sm" key={calendar.id}>
                  <input checked={conflicts.includes(calendar.id)} onChange={(event) => setConflicts((current) => event.target.checked ? [...current, calendar.id] : current.filter((id) => id !== calendar.id))} type="checkbox" />
                  <span>{calendar.summary}</span>
                </label>)}
              </fieldset>
              <label className="flex flex-col gap-1 text-sm font-medium">Add bookings to
                <select className="min-h-10 rounded-md border bg-background px-2" onChange={(event) => setBooking(event.target.value)} value={booking}>
                  {calendars.filter((calendar) => calendar.accessRole === "owner" || calendar.accessRole === "writer").map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}
                </select>
              </label>
              <Button className="min-h-11" disabled={busy || !booking || conflicts.length === 0} onClick={() => void save()} type="button">{busy ? "Saving…" : "Save calendar choices"}</Button>
            </>
          )}
          {confirmDisconnect ? <div className="space-y-2 rounded-xl border p-3">
            <p className="text-sm">Disconnecting pauses new requests. Existing requests stay open, but calendar-dependent work waits until you reconnect and complete setup. Existing bookings and Calendar events stay in place.</p>
            <div className="flex gap-2"><Button className="min-h-11" disabled={busy} onClick={() => void disconnect()} type="button" variant="destructive">Disconnect</Button><Button className="min-h-11" disabled={busy} onClick={() => setConfirmDisconnect(false)} type="button" variant="outline">Keep connected</Button></div>
          </div> : <Button className="min-h-11" disabled={busy} onClick={() => setConfirmDisconnect(true)} type="button" variant="outline">Disconnect Google Calendar</Button>}
        </>
      ) : <div className="space-y-2"><p className="text-sm text-muted-foreground">Google Calendar is not connected.</p><a className="text-sm underline underline-offset-4" href="/auth/sign-in?consent=calendar">Reconnect Google Calendar</a></div>}
      {notice ? <p className="text-sm" role="status">{notice}</p> : null}
    </section>
  );
}
