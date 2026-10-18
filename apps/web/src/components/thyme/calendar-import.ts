// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17
"use client";

import { useEffect, useRef } from "react";
import type { z } from "zod";
import { request } from "@/components/api";
import { calendarConnectionViewSchema, syncViewSchema, type CalendarConnectionView } from "@/contracts/calendar";

// "Connect my Google Calendar too" without a calendar screen: after sign-in the host page does what the calendar
// settings screen does by hand — fetch the calendar list, keep the calendars with event details, import them.
// Demo mode has no Google, so the landing's `?calendar=1` attaches the account's example calendar first.
// It runs once per visit and only while nothing has been imported; failures leave the host where they were,
// and the calendar settings screen can still finish the job.

const command = <T,>(name: string, payload: unknown, schema: z.ZodType<T>) =>
  request("POST", `/api/calendar/${name}`, schema, payload, crypto.randomUUID());

async function importCalendar(attachExample: boolean): Promise<boolean> {
  const read = await request("GET", "/api/calendar", calendarConnectionViewSchema);
  if (!read.ok) return false;
  let view: CalendarConnectionView = read.data;
  if (view.analysis || view.schedule || view.status === "reconnect_required") return false;
  const linked = () => view.sources.length > 0 || view.status === "connected" || view.status === "needs_refresh";
  if (!linked() && attachExample) {
    const r = await command("mock-connect", {}, calendarConnectionViewSchema);
    if (!r.ok) return false;
    view = r.data;
  }
  if (!linked()) return false;
  if (!view.sources.length) {
    const r = await command("catalog", {}, calendarConnectionViewSchema);
    if (!r.ok) return false;
    view = r.data;
  }
  // the calendar settings screen's default choice: what was saved, else every calendar that shows event details
  const saved = view.sources.filter((s) => s.selected).map((s) => s.id);
  if (!saved.length) {
    const ids = view.sources.filter((s) => s.access === "detail").map((s) => s.id);
    if (!ids.length) return false;
    const r = await command("selection", { expectedSelectionRevision: view.selectionRevision, calendarIds: ids }, calendarConnectionViewSchema);
    if (!r.ok) return false;
    view = r.data;
  }
  return (await command("sync", { expectedSelectionRevision: view.selectionRevision }, syncViewSchema)).ok;
}

/** Imports the calendar once in the background; `onImported` runs when there is something new to show. */
export function useCalendarImport(attachExample: boolean, onImported: () => void) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void importCalendar(attachExample).then((imported) => { if (imported) onImported(); });
  }, [attachExample, onImported]);
}
