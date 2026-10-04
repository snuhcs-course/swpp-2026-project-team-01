import { createGoogle } from './google.ts';
import type { Environment } from '../env.ts';
const env = { googleClientId: 'client', googleClientSecret: 'secret' } as Environment;
Deno.test('refresh preserves refresh token and scopes when Google rotates access token only', async () => {
  const google = createGoogle(
    env,
    (() =>
      Promise.resolve(
        Response.json({ access_token: 'new-access', expires_in: 3600 }),
      )) as typeof fetch,
  );
  const refreshed = await google.refresh({
    accessToken: 'expired',
    refreshToken: 'stable-refresh',
    expiresAt: new Date(0).toISOString(),
    scope: 'availability',
  });
  if (
    refreshed.refreshToken !== 'stable-refresh' || refreshed.scope !== 'availability' ||
    refreshed.accessToken !== 'new-access'
  ) throw new Error('Refresh changed durable grant');
});
Deno.test('calendar discovery follows pages and returns only safe calendar fields', async () => {
  let calls = 0;
  const google = createGoogle(
    env,
    (() =>
      Promise.resolve(Response.json(
        ++calls === 1
          ? {
            items: [{ id: 'one', summary: 'Work', accessRole: 'owner', privateSecret: 'excluded' }],
            nextPageToken: 'next',
          }
          : { items: [{ id: 'two', summary: 'Personal', accessRole: 'reader' }] },
      ))) as typeof fetch,
  );
  const calendars = await google.calendars({
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: new Date().toISOString(),
    scope: 'calendar',
  });
  if (calendars.length !== 2 || calls !== 2 || 'privateSecret' in calendars[0]) {
    throw new Error('Unsafe or incomplete calendar discovery');
  }
});
Deno.test('revoked refresh credential requires reconnection rather than retrying empty calendar', async () => {
  const { DomainError } = await import('../errors.ts');
  const google = createGoogle(
    env,
    (() =>
      Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 400 }))) as typeof fetch,
  );
  try {
    await google.refresh({
      accessToken: 'expired',
      refreshToken: 'revoked',
      expiresAt: new Date(0).toISOString(),
      scope: 'availability',
    });
    throw new Error('Unexpected successful refresh');
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'reconnect_required') throw error;
  }
});
