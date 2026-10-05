// deno-lint-ignore no-import-prefix
import { Hono } from 'npm:hono@4.13.13';
import type { Database } from '../../_shared/database.ts';
import { actorFor } from '../../_shared/database.ts';
import type { Environment } from '../../_shared/env.ts';
import { DomainError } from '../../_shared/errors.ts';
import { hashToken, jsonInput } from '../../_shared/security.ts';
import { imessageBridgeRoutes } from '../../_shared/modules/onboarding/conversation-bridge.ts';
import { createSetupConversation } from '../../_shared/modules/onboarding/conversation.ts';
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
  const conversation = createSetupConversation(env, db, undefined, async (actor) => {
    const { credential } = await oauth.credential({ hostId: actor.id! });
    return await oauth.google.calendars(credential);
  });
  app.route('/internal/setup/imessage', imessageBridgeRoutes(env, db, conversation));
  app.get(
    '/host/setup/conversation',
    async (c) => c.json(await conversation.read(await actorFor(c.req.raw, db, undefined, true))),
  );
  app.post('/host/setup/conversation/messages', async (c) => {
    const actor = await actorFor(c.req.raw, db, undefined, true);
    const input = await jsonInput(c.req.raw);
    return c.json(
      await conversation.append(actor, { ...input, idempotencyKey: mutationKey(c.req.raw) }),
    );
  });
  app.post('/host/setup/conversation/confirm', async (c) => {
    const actor = await actorFor(c.req.raw, db, undefined, true);
    const input = await jsonInput(c.req.raw);
    return c.json(
      await conversation.confirm(actor, { ...input, idempotencyKey: mutationKey(c.req.raw) }),
    );
  });
  app.get('/host/imessage/link', async (c) => {
    const state = await conversation.read(await actorFor(c.req.raw, db, undefined, true));
    return c.json({
      available: !!env.photonBridgeEnabled,
      contactUrl: env.photonContactUrl || null,
      link: state.channelLink,
      challenge: state.linkChallenge
        ? { ...state.linkChallenge, senderLabel: state.linkChallenge.maskedSender }
        : null,
    });
  });
  app.post('/host/imessage/link/start', async (c) => {
    const actor = await actorFor(c.req.raw, db, undefined, true);
    if (!env.photonBridgeEnabled) throw new DomainError('provider_unavailable', 503);
    const input = await jsonInput(c.req.raw);
    if (
      (input.continuationId !== undefined &&
        (typeof input.continuationId !== 'string' ||
          !/^[a-f\d-]{36}$/i.test(input.continuationId))) ||
      (input.continuationSecret !== undefined &&
        (typeof input.continuationSecret !== 'string' ||
          !/^[A-Za-z\d_-]{32,128}$/.test(input.continuationSecret)))
    ) throw new DomainError('invalid_input');
    const key = mutationKey(c.req.raw);
    const challengeSecret = await hashToken(
      `link-challenge:${env.photonBridgeSecret}:${actor.id}:${key}`,
    );
    const browserProof = await hashToken(
      `link-browser:${env.photonBridgeSecret}:${actor.id}:${key}`,
    );
    const result = await db.command<Record<string, unknown>>('setup_link_challenge_start', actor, {
      continuationId: input.continuationId,
      continuationSecretHash: typeof input.continuationSecret === 'string'
        ? await hashToken(input.continuationSecret)
        : undefined,
      challengeSecretHash: await hashToken(challengeSecret),
      browserProofHash: await hashToken(browserProof),
      idempotencyKey: mutationKey(c.req.raw),
    });
    return c.json({
      ...result,
      challengeSecret,
      browserProof,
      challengeText: `LINK ${result.challengeId} ${challengeSecret}`,
      contactUrl: env.photonContactUrl || null,
    });
  });
  app.post('/host/imessage/link/confirm', async (c) => {
    const actor = await actorFor(c.req.raw, db, undefined, true);
    const input = await jsonInput(c.req.raw);
    if (
      typeof input.challengeId !== 'string' || typeof input.browserProof !== 'string' ||
      input.browserProof.length < 32 || input.browserProof.length > 128
    ) throw new DomainError('invalid_input');
    return c.json(
      await db.command('setup_link_confirm', actor, {
        challengeId: input.challengeId,
        browserProofHash: await hashToken(input.browserProof),
        idempotencyKey: mutationKey(c.req.raw),
      }),
    );
  });
  app.post('/host/imessage/unlink', async (c) => {
    const actor = await actorFor(c.req.raw, db, undefined, true);
    const input = await jsonInput(c.req.raw);
    return c.json(
      await db.command('setup_link_unlink', actor, {
        linkId: input.linkId,
        idempotencyKey: mutationKey(c.req.raw),
      }),
    );
  });

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
    const input = await jsonInput(c.req.raw);
    if (!Number.isInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) {
      throw new DomainError('invalid_input');
    }
    await db.command('request_read', actor, { requestId });
    const prior = await oauth.credential({ requestId }).catch(() => null);
    const result = await db.command('request_calendar_disconnect', actor, {
      requestId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: mutationKey(c.req.raw),
    });
    if (prior) await oauth.google.revoke(prior.credential).catch(() => undefined);
    return c.json(result);
  });
  return app;
}
