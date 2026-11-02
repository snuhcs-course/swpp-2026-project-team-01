// The least Calendar scopes that cover the host's needs, checked against the
// Calendar API reference on 2026-10-19:
// - calendarList.list accepts calendar.calendarlist.readonly (reading the calendar list);
// - events.list and events.insert both accept calendar.events (reading events on any
//   selected calendar, including subscribed ones, and creating the booking event on a
//   writable destination the host need not own).
// Nothing calls freebusy.query: free/busy-only calendars are left out because their
// events cannot be read (calendar-roles.ts), so calendar.events.freebusy was dropped on
// 2026-11-02 rather than submitted unused for Google's verification. Hosts who granted
// it before keep a working grant. Supabase Auth adds the identity scopes (openid,
// email, profile) itself.
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export function grantedCalendarScopes(grantedScopes: readonly string[]) {
  return GOOGLE_CALENDAR_SCOPES.filter((scope) => grantedScopes.includes(scope));
}
