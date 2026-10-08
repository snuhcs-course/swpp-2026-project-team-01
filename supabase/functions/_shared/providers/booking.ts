// AI-generated with Codex, 2026-10-05 (Asia/Seoul).
import type {
  BookingAttempt,
  InsertResult,
  LookupResult,
  ProviderEvent,
} from '../modules/booking/index.ts';
import type { GoogleCredential } from './google.ts';
import type { Fetcher } from './transport.ts';
const fields =
  'id,status,htmlLink,summary,description,location,start,end,attendees(email),extendedProperties,recurrence';
/** Only SQL-frozen event identity, payload and destination may reach Google writes. */
export function createBookingProvider(
  credential: (attempt: Readonly<BookingAttempt>) => Promise<GoogleCredential>,
  fetcher: Fetcher = fetch,
) {
  return {
    async insert(attempt: Readonly<BookingAttempt>): Promise<InsertResult> {
      let token: GoogleCredential;
      try {
        token = await credential(attempt);
      } catch {
        return { kind: 'rejected', code: 'permission_denied' };
      }
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${
          encodeURIComponent(attempt.calendarId)
        }/events`,
      );
      url.search = new URLSearchParams({ sendUpdates: 'all', fields }).toString();
      try {
        const response = await fetcher(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(attempt.payload),
          signal: AbortSignal.timeout(12000),
        });
        if (response.status === 409) return { kind: 'duplicate' };
        if (!response.ok) {
          if (response.status >= 500 || [408, 429].includes(response.status)) {
            return { kind: 'uncertain', code: 'calendar_insert_unavailable' };
          }
          return {
            kind: 'rejected',
            code: response.status === 401 || response.status === 403
              ? 'permission_denied'
              : response.status === 404
              ? 'calendar_not_found'
              : 'calendar_insert_rejected',
          };
        }
        const event = await response.json() as ProviderEvent;
        return { kind: 'created', event };
      } catch {
        return { kind: 'uncertain', code: 'calendar_insert_response_lost' };
      }
    },
    async lookup(attempt: Readonly<BookingAttempt>): Promise<LookupResult> {
      let token: GoogleCredential;
      try {
        token = await credential(attempt);
      } catch {
        return { kind: 'credential_error', code: 'calendar_lookup_credentials' };
      }
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${
          encodeURIComponent(attempt.calendarId)
        }/events/${encodeURIComponent(attempt.eventId)}`,
      );
      url.search = new URLSearchParams({ fields }).toString();
      try {
        const response = await fetcher(url, {
          headers: { Authorization: `Bearer ${token.accessToken}` },
          signal: AbortSignal.timeout(12000),
        });
        if (response.status === 404) return { kind: 'not_found' };
        if (response.status === 401 || response.status === 403) {
          return { kind: 'credential_error', code: 'calendar_lookup_credentials' };
        }
        if (!response.ok) return { kind: 'unavailable', code: 'calendar_lookup_unavailable' };
        return { kind: 'found', event: await response.json() as ProviderEvent };
      } catch {
        return { kind: 'unavailable', code: 'calendar_lookup_response_lost' };
      }
    },
  };
}
