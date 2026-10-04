// deno-lint-ignore no-import-prefix
import { Hono } from 'npm:hono@4.13.13';
import type { Database } from '../../_shared/database.ts';
import { actorFor } from '../../_shared/database.ts';
import type { Environment } from '../../_shared/env.ts';
import { DomainError } from '../../_shared/errors.ts';
import { hashToken, jsonInput } from '../../_shared/security.ts';
import { createOAuth } from '../../_shared/modules/onboarding/oauth.ts';
export function mutationKey(request: Request): string {
  const key = request.headers.get('Idempotency-Key');
  if (!key || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new DomainError('invalid_input');
  }
  return key;
}
export function onboardingRoutes(env: Environment, db: Database, oauth = createOAuth(env, db)) {
  const app = new Hono();
  app.post('/waitlist', async (c) => {
    const input = await jsonInput(c.req.raw);
    if (
      typeof input.email !== 'string' || input.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
      (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 200))
    ) throw new DomainError('invalid_input');
    return c.json(
      await db.command('waitlist_join', { kind: 'public' }, {
        email: input.email.trim().toLowerCase(),
        name: input.name,
        idempotencyKey: mutationKey(c.req.raw),
      }),
    );
  });
  app.get(
    '/hosts/:handle',
    async (c) =>
      c.json(
        await db.command('host_public', { kind: 'public' }, { handle: c.req.param('handle') }),
      ),
  );
  app.get(
    '/host/setup',
    async (c) =>
      c.json(await db.command('setup_read', await actorFor(c.req.raw, db, undefined, true), {})),
  );
  app.post('/host/invitations/redeem', async (c) => {
    const actor = await actorFor(c.req.raw, db, undefined, true);
    const input = await jsonInput(c.req.raw);
    if (typeof input.token !== 'string' || input.token.length < 32 || input.token.length > 256) {
      throw new DomainError('invalid_input');
    }
    return c.json(
      await db.command('invite_redeem', actor, {
        tokenHash: await hashToken(input.token),
        idempotencyKey: mutationKey(c.req.raw),
      }),
    );
  });
  app.post('/host/setup', async (c) => {
    const actor = await actorFor(c.req.raw, db, undefined, true);
    const input = await jsonInput(c.req.raw);
    return c.json(
      await db.command('setup_save', actor, {
        handle: input.handle,
        displayName: input.displayName,
        rules: input.rules,
        idempotencyKey: mutationKey(c.req.raw),
      }),
    );
  });
  app.post('/host/google/connect', async (c) => {
    const actor = await actorFor(c.req.raw, db, undefined, true);
    const result = await oauth.start(actor, mutationKey(c.req.raw));
    c.header('Set-Cookie', result.cookie);
    return c.json({ url: result.url });
  });
  app.get('/google/callback', async (c) => {
    const result = await oauth.callback(c.req.raw);
    c.header('Set-Cookie', result.cookie);
    return c.redirect(result.redirect, 303);
  });
  app.get('/host/calendars', async (c) => {
    const actor = await actorFor(c.req.raw, db, undefined, true);
    const { credential } = await oauth.credential({ hostId: actor.id! });
    return c.json({ calendars: await oauth.google.calendars(credential) });
  });
  app.post('/host/calendar-settings', async (c) => {
    const actor = await actorFor(c.req.raw, db, undefined, true);
    const input = await jsonInput(c.req.raw);
    const { credential } = await oauth.credential({ hostId: actor.id! });
    const verifiedCalendars = await oauth.google.calendars(credential);
    return c.json(
      await db.command('calendar_save', actor, {
        conflictCalendarIds: input.conflictCalendarIds,
        bookingCalendarId: input.bookingCalendarId,
        verifiedCalendars: verifiedCalendars.map(({ id, accessRole }) => ({ id, accessRole })),
        idempotencyKey: mutationKey(c.req.raw),
      }),
    );
  });
  app.post('/host/calendar/disconnect', async (c) => {
    const actor = await actorFor(c.req.raw, db, undefined, true);
    const prior = await oauth.credential({ hostId: actor.id! }).catch(() => null);
    const result = await db.command('calendar_disconnect', actor, {
      idempotencyKey: mutationKey(c.req.raw),
    });
    if (prior) await oauth.google.revoke(prior.credential).catch(() => undefined);
    return c.json(result);
  });
  app.post('/requests/:id/google/connect', async (c) => {
    const actor = await actorFor(c.req.raw, db, c.req.param('id'));
    if (actor.kind !== 'guest') throw new DomainError('forbidden', 403);
    const result = await oauth.start(actor, mutationKey(c.req.raw));
    c.header('Set-Cookie', result.cookie);
    return c.json({ url: result.url });
  });
  app.post('/requests/:id/calendar/disconnect', async (c) => {
    const requestId = c.req.param('id');
    const actor = await actorFor(c.req.raw, db, requestId);
    if (actor.kind !== 'guest') throw new DomainError('forbidden', 403);
    const prior = await oauth.credential({ requestId }).catch(() => null);
    const result = await db.command('calendar_disconnect', actor, {
      requestId,
      idempotencyKey: mutationKey(c.req.raw),
    });
    if (prior) await oauth.google.revoke(prior.credential).catch(() => undefined);
    return c.json(result);
  });
  return app;
}
