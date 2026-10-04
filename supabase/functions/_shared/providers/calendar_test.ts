import { createCalendarReader, createRoutes } from './calendar.ts';
import type { GoogleCredential } from './google.ts';
import type { Environment } from '../env.ts';
const credential: GoogleCredential = {
  accessToken: 'synthetic',
  refreshToken: 'refresh',
  expiresAt: '2030-01-01T00:00:00Z',
  scope: 'read',
};
Deno.test('host calendar adapter excludes virtual location and private descriptions', async () => {
  const fetcher = (() =>
    Promise.resolve(Response.json({
      items: [{
        id: 'virtual',
        start: { dateTime: '2030-06-01T09:00:00Z' },
        end: { dateTime: '2030-06-01T10:00:00Z' },
        location: 'Private address',
        description: 'Private note',
        hangoutLink: 'https://meet.example',
      }, {
        id: 'physical',
        start: { dateTime: '2030-06-01T11:00:00Z' },
        end: { dateTime: '2030-06-01T12:00:00Z' },
        location: 'Office',
      }],
    }))) as typeof fetch;
  const events = await createCalendarReader(fetcher).hostEvents(
    credential,
    ['work'],
    '2030-06-01T00:00:00Z',
    '2030-06-02T00:00:00Z',
    'UTC',
  );
  if (
    events[0].physicalLocation || events[0].location ||
    JSON.stringify(events).includes('Private note') || events[1].physicalLocation !== 'Office'
  ) throw new Error('Unsafe calendar normalization');
});
Deno.test('requester freebusy errors block instead of producing empty availability', async () => {
  const fetcher = (() =>
    Promise.resolve(
      Response.json({ calendars: { primary: { errors: [{ reason: 'notFound' }], busy: [] } } }),
    )) as typeof fetch;
  let rejected = false;
  try {
    await createCalendarReader(fetcher).requesterBusy(
      credential,
      '2030-06-01T00:00:00Z',
      '2030-06-02T00:00:00Z',
    );
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('Unavailable calendar treated empty');
});
Deno.test('routes missing estimate remains unresolved and never becomes zero', async () => {
  const fetcher = (() => Promise.resolve(Response.json({ routes: [] }))) as typeof fetch;
  const route = createRoutes({ routesKey: 'synthetic' } as Environment, fetcher);
  if (
    await route({
      origin: 'Office',
      destination: 'Meeting',
      mode: 'DRIVE',
      departureTime: '2030-06-01T09:00:00Z',
    }) !== null
  ) throw new Error('Missing route became valid');
});
