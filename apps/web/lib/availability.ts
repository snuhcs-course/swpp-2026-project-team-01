// AI-generated with OpenAI Codex, 2026-10-05.
/** All scheduling boundaries are in Asia/Seoul, regardless of the server timezone. */
export type TimeWindow = { start: string; end: string };
export type CalendarEvent = TimeWindow & { id: string; title: string; location: string; allDay: boolean; busy: boolean };
export const DAY_MS = 86_400_000;
export const SEOUL_OFFSET = 9 * 3_600_000;

export function seoulDay(offset = 0, hour = 0, minute = 0, now = Date.now()) {
  const date = new Date(now + SEOUL_OFFSET);
  date.setUTCHours(hour, minute, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return new Date(date.getTime() - SEOUL_OFFSET);
}

export function availabilityPeriod(now = Date.now()) {
  return { start: seoulDay(1, 9, 0, now).toISOString(), end: seoulDay(14, 20, 0, now).toISOString() };
}

export function ownerAvailability(events: Array<{ start: Date; end: Date; busy?: boolean }>, now = Date.now()): TimeWindow[] {
  const windows: TimeWindow[] = [];
  const blocked = events.filter((event) => event.busy !== false).map((event) => ({
    start: event.start.getTime() - 15 * 60_000,
    end: event.end.getTime() + 15 * 60_000,
  })).sort((a, b) => a.start - b.start);
  function addWindow(start: number, end: number) {
    // Candidate starts use a 30-minute grid; do not advertise unusably short gaps.
    const alignedStart = Math.ceil(start / (30 * 60_000)) * 30 * 60_000;
    if (end - alignedStart >= 30 * 60_000) windows.push({ start: new Date(alignedStart).toISOString(), end: new Date(end).toISOString() });
  }
  for (let day = 1; day <= 14; day++) {
    const from = seoulDay(day, 9, 0, now).getTime();
    const to = seoulDay(day, 20, 0, now).getTime();
    const weekday = new Date(from + SEOUL_OFFSET).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    let cursor = from;
    for (const event of blocked) {
      if (event.end <= cursor || event.start >= to) continue;
      addWindow(cursor, event.start);
      cursor = Math.min(to, Math.max(cursor, event.end));
    }
    addWindow(cursor, to);
  }
  return windows;
}

export function insideWindows(start: Date, end: Date, windows?: TimeWindow[] | null) {
  return windows == null || windows.some((window) => start.getTime() >= Date.parse(window.start) && end.getTime() <= Date.parse(window.end));
}

export function linkIsOpen(link: { active: boolean; deleted_at: string | null; availability_end: string | null }, now = Date.now()) {
  return link.active && !link.deleted_at && (!link.availability_end || Date.parse(link.availability_end) > now);
}
