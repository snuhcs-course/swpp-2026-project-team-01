import type { GoogleCredential } from './google.ts';
import { type Fetcher, providerJson } from './transport.ts';
import { DomainError } from '../errors.ts';
import { resolveLocalDateTime } from '../modules/scheduling/time.ts';
import type { HostEvent, RouteQuery } from '../modules/scheduling/index.ts';
import type { Environment } from '../env.ts';
import type { TimeWindow } from '../../../../packages/contracts/index.ts';
interface CalendarEvent {
  id: string;
  status?: string;
  transparency?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  hangoutLink?: string;
  conferenceData?: unknown;
}
export function createCalendarReader(fetcher: Fetcher = fetch) {
  return {
    async hostEvents(
      credential: GoogleCredential,
      calendars: string[],
      start: string,
      end: string,
      timezone: string,
    ): Promise<HostEvent[]> {
      const events: HostEvent[] = [];
      const read = async (calendarId: string) => {
        let next: string | undefined;
        for (let page = 0; page < 10; page++) {
          const url = new URL(
            `https://www.googleapis.com/calendar/v3/calendars/${
              encodeURIComponent(calendarId)
            }/events`,
          );
          url.search = new URLSearchParams({
            timeMin: start,
            timeMax: end,
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: '2500',
            fields:
              'items(id,status,transparency,start,end,location,hangoutLink,conferenceData),nextPageToken',
            ...(next ? { pageToken: next } : {}),
          }).toString();
          const { data } = await providerJson<{ items?: CalendarEvent[]; nextPageToken?: string }>(
            url.toString(),
            { headers: { Authorization: `Bearer ${credential.accessToken}` } },
            fetcher,
          );
          for (const event of data.items || []) {
            if (event.status === 'cancelled' || event.transparency === 'transparent') continue;
            const eventStart = event.start.dateTime ||
              (event.start.date &&
                resolveLocalDateTime(
                  `${event.start.date}T00:00:00`,
                  event.start.timeZone || timezone,
                ));
            const eventEnd = event.end.dateTime ||
              (event.end.date &&
                resolveLocalDateTime(`${event.end.date}T00:00:00`, event.end.timeZone || timezone));
            if (!eventStart || !eventEnd) throw new DomainError('provider_unavailable', 503);
            const online = !!event.hangoutLink || !!event.conferenceData;
            events.push({
              id: `${calendarId}:${event.id}`,
              start: eventStart,
              end: eventEnd,
              mode: online ? 'online' : 'in_person',
              ...(!online && event.location
                ? { location: event.location, physicalLocation: event.location }
                : {}),
            });
            if (events.length > 25000) throw new DomainError('provider_unavailable', 503);
          }
          next = data.nextPageToken;
          if (!next) return;
        }
        throw new DomainError('provider_unavailable', 503);
      };
      for (let offset = 0; offset < calendars.length; offset += 5) {
        await Promise.all(calendars.slice(offset, offset + 5).map(read));
      }
      return events;
    },
    async requesterBusy(
      credential: GoogleCredential,
      start: string,
      end: string,
    ): Promise<TimeWindow[]> {
      const { data } = await providerJson<
        { calendars?: Record<string, { busy?: TimeWindow[]; errors?: unknown[] }> }
      >('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin: start,
          timeMax: end,
          timeZone: 'UTC',
          items: [{ id: 'primary' }],
        }),
      }, fetcher);
      const calendar = data.calendars?.primary;
      if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) {
        throw new DomainError('reconnect_required', 409);
      }
      return calendar.busy.map(({ start, end }) => ({ start, end }));
    },
  };
}
export function createRoutes(env: Environment, fetcher: Fetcher = fetch) {
  let requests = 0;
  return async (query: RouteQuery): Promise<{ durationMinutes: number } | null> => {
    if (!env.routesKey || ++requests > 12) return null;
    try {
      const { data } = await providerJson<{ routes?: { duration?: string }[] }>(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': env.routesKey,
            'X-Goog-FieldMask': 'routes.duration',
          },
          body: JSON.stringify({
            origin: { address: query.origin },
            destination: { address: query.destination },
            travelMode: query.mode,
            departureTime: query.departureTime,
            ...(query.mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
          }),
        },
        fetcher,
      );
      const duration = data.routes?.[0]?.duration;
      if (!duration || !/^\d+(?:\.\d+)?s$/.test(duration)) return null;
      const minutes = Number(duration.slice(0, -1)) / 60;
      return Number.isFinite(minutes) && minutes >= 0 && minutes <= 1440
        ? { durationMinutes: minutes }
        : null;
    } catch {
      return null;
    }
  };
}
