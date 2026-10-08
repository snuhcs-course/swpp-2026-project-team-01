// AI-generated with OpenAI Codex, 2026-10-05.
export class CalendarWriteError extends Error {
  constructor(public status: number, public uncertain = false) { super("Google Calendar operation failed"); }
}
export type GoogleBooking = { id: string; status?: string; htmlLink?: string; start?: { dateTime?: string }; end?: { dateTime?: string }; extendedProperties?: { private?: { caltalkRequestId?: string } } };
const eventsUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export async function findGoogleBooking(accessToken: string, id: string): Promise<GoogleBooking | null> {
  const response = await fetch(`${eventsUrl}/${encodeURIComponent(id)}?fields=id,status,htmlLink,start,end,extendedProperties`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new CalendarWriteError(response.status);
  return response.json();
}

export async function insertGoogleBooking(accessToken: string, booking: { id: string; requestId: string; purpose: string; name: string; email: string; location: string; start: string; end: string }) {
  let response: Response;
  try {
    response = await fetch(`${eventsUrl}?sendUpdates=all`, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        id: booking.id, summary: booking.purpose, location: booking.location,
        start: { dateTime: booking.start, timeZone: "Asia/Seoul" }, end: { dateTime: booking.end, timeZone: "Asia/Seoul" },
        attendees: [{ email: booking.email, displayName: booking.name }],
        guestsCanModify: false, guestsCanInviteOthers: false,
        extendedProperties: { private: { caltalkRequestId: booking.requestId } },
      }),
    });
  } catch { throw new CalendarWriteError(502, true); }
  if (!response.ok) throw new CalendarWriteError(response.status, response.status >= 500 || response.status === 409);
  try { return await response.json() as GoogleBooking; } catch { throw new CalendarWriteError(502, true); }
}
