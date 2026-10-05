// deno-lint-ignore no-import-prefix
import { Hono } from 'npm:hono@4.13.13';
import type { Database } from '../../database.ts';
import type { Environment } from '../../env.ts';
import type { SetupConversationState } from '../../../../../packages/contracts/index.ts';
import { DomainError } from '../../errors.ts';
import { constantTimeEqual, hashToken, jsonInput } from '../../security.ts';
import { type createSetupConversation, protectedSetupText } from './conversation.ts';
const worker = { kind: 'worker' as const, id: 'photon-setup-bridge' };
async function key(domain: string, value: unknown) {
  return `${domain}-${await hashToken(JSON.stringify(value))}`;
}
export function imessageBridgeRoutes(
  env: Environment,
  db: Database,
  conversation: ReturnType<typeof createSetupConversation>,
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (!env.photonBridgeEnabled || !env.photonBridgeSecret) {
      throw new DomainError('provider_unavailable', 503);
    }
    const token = c.req.header('Authorization')?.replace(/^Bearer /, '') || '';
    if (!await constantTimeEqual(token, env.photonBridgeSecret)) {
      throw new DomainError('unauthorized', 401);
    }
    await next();
  });
  app.post('/resume', async (c) => {
    const value = await db.command<{ lastSequence: string | number | null }>(
      'setup_bridge_resume',
      worker,
      { provider: 'imessage' },
    );
    const lastSequence = Number(value.lastSequence || 0);
    if (!Number.isSafeInteger(lastSequence)) throw new DomainError('invalid_state');
    return c.json({ lastSequence });
  });
  app.post('/checkpoint', async (c) => {
    const input = await jsonInput(c.req.raw);
    if (
      !/^\d{1,20}$/.test(String(input.sequence)) ||
      !/^[a-z_]{1,80}$/.test(String(input.disposition))
    ) throw new DomainError('invalid_input');
    return c.json(
      await db.command('setup_bridge_checkpoint', worker, {
        provider: 'imessage',
        disposition: input.disposition,
        providerSequence: String(input.sequence),
        idempotencyKey: await key('checkpoint', input.sequence),
      }),
    );
  });
  app.post('/inbound', async (c) => {
    const input = await jsonInput(c.req.raw);
    if (
      input.service !== 'iMessage' || input.isGroup === true || typeof input.sender !== 'string' ||
      !/^(\+[1-9]\d{7,14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(input.sender) ||
      typeof input.conversationId !== 'string' ||
      input.conversationId !== `any;-;${input.sender}` ||
      typeof input.providerMessageId !== 'string' || !input.providerMessageId ||
      input.providerMessageId.length > 500 || typeof input.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(input.createdAt))
    ) throw new DomainError('invalid_provider_evidence');
    if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > 4000) {
      throw new DomainError('invalid_input');
    }
    const text = protectedSetupText(input.body);
    const binding = {
      provider: 'imessage',
      senderId: input.sender,
      privateConversationId: input.conversationId,
      isGroup: false,
    };
    const linkMatch = /^LINK ([a-f\d-]{36}) ([A-Za-z\d_-]{32,128})$/i.exec(input.body.trim());
    if (linkMatch) {
      try {
        await db.command('setup_link_challenge_claim', worker, {
          ...binding,
          challengeId: linkMatch[1],
          challengeSecretHash: await hashToken(linkMatch[2]),
          idempotencyKey: await key('link-claim', input.providerMessageId),
        });
      } catch (error) {
        if (
          error instanceof DomainError &&
          ['challenge_invalid', 'invalid_input', 'forbidden'].includes(error.code)
        ) return c.json({ disposition: 'rejected' });
        throw error;
      }
      return c.json({ disposition: 'processed' });
    }
    let linked: Record<string, unknown>;
    try {
      linked = await db.command<Record<string, unknown>>(
        'setup_channel_authorize',
        worker,
        binding,
      );
    } catch (error) {
      if (
        !(error instanceof DomainError) || !['link_not_found', 'forbidden'].includes(error.code)
      ) throw error;
      const continuationSecret = await hashToken(
        `inbound-link:${env.photonBridgeSecret}:${input.providerMessageId}`,
      );
      const continuationId = (await hashToken(`continuation:${input.providerMessageId}`)).slice(
        0,
        32,
      ).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
      const clientMessageId = (await hashToken(`continuation-outbound:${input.providerMessageId}`))
        .slice(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
      const continuationUrl =
        `${env.appOrigin}/host/setup#imessage=${continuationId}&proof=${continuationSecret}`;
      try {
        await db.command('setup_link_inbound_start', worker, {
          ...binding,
          continuationId,
          clientMessageId,
          replyText:
            `Set up your host account in the website: ${continuationUrl}. Sign in, redeem your invitation, then verify this private iMessage conversation.`,
          continuationSecretHash: await hashToken(continuationSecret),
          idempotencyKey: await key('inbound-link', input.providerMessageId),
        });
      } catch (error) {
        if (
          error instanceof DomainError && ['rate_limited', 'challenge_invalid'].includes(error.code)
        ) return c.json({ disposition: 'rejected' });
        throw error;
      }
      return c.json({ disposition: 'processed' });
    }
    const inbound = await db.command<Record<string, unknown>>(
      'setup_provider_inbound_record',
      worker,
      {
        ...binding,
        providerMessageId: input.providerMessageId,
        occurredAt: input.createdAt,
        text,
        idempotencyKey: await key('inbound', input.providerMessageId),
      },
    );
    if (inbound.duplicate && inbound.existingOutbound) return c.json({ disposition: 'processed' });
    const state = await conversation.read(worker, binding);
    const clientTurnId = (await hashToken(input.providerMessageId)).slice(0, 32).replace(
      /(.{8})(.{4})(.{4})(.{4})(.{12})/,
      '$1-$2-$3-$4-$5',
    );
    const confirm = /^CONFIRM (\d{1,9})$/i.exec(text);
    const result = inbound.processed && inbound.result
      ? inbound.result as SetupConversationState
      : confirm && state.review?.status === 'pending' &&
          Number(confirm[1]) === state.review.revision && state.draft
      ? await conversation.confirm(worker, {
        ...binding,
        reviewRevision: Number(confirm[1]),
        providerMessageId: input.providerMessageId,
        expectedRevision: state.revision,
        expectedDraftRevision: state.draft.revision,
        expectedRulesVersion: state.draft.baseRulesVersion,
        idempotencyKey: await key('confirm', input.providerMessageId),
      })
      : await conversation.append(worker, {
        ...binding,
        text,
        clientTurnId,
        expectedRevision: state.revision,
        providerMessageId: input.providerMessageId,
        idempotencyKey: await key('turn', input.providerMessageId),
      }, 'imessage');
    const review = result.review?.status === 'pending'
      ? `\nReview ${result.review.revision}: ${
        JSON.stringify(result.review.settings)
      }\nReply CONFIRM ${result.review.revision} to save these exact settings.`
      : '';
    let body = `${
      result.turns.at(-1)?.text || 'Continue setup in the website.'
    }${review}\n${env.appOrigin}/host/setup`;
    if (body.length > 4000) {
      body =
        `Your setup draft is ready for review. Open the website to review the complete exact settings before confirming: ${env.appOrigin}/host/setup`;
    }
    const messageId = (await hashToken(`outbound:${inbound.inboundId}`)).slice(0, 32).replace(
      /(.{8})(.{4})(.{4})(.{4})(.{12})/,
      '$1-$2-$3-$4-$5',
    );
    await db.command('setup_provider_outbound_prepare', worker, {
      inboundId: inbound.inboundId,
      clientMessageId: messageId,
      text: body,
      idempotencyKey: await key('outbound', inbound.inboundId),
    });
    return c.json({ disposition: 'processed', conversationId: linked.conversationId });
  });
  app.post(
    '/outbound/claim',
    async (c) =>
      c.json(await db.command('setup_provider_outbound_claim', worker, { provider: 'imessage' })),
  );
  app.post('/outbound/authorize', async (c) => {
    const input = await jsonInput(c.req.raw);
    if (typeof input.intentId !== 'string' || !/^[a-f\d-]{36}$/i.test(input.intentId)) {
      throw new DomainError('invalid_input');
    }
    try {
      const result = await db.command<Record<string, unknown>>(
        'setup_provider_outbound_authorize',
        worker,
        { intentId: input.intentId },
      );
      return c.json({
        authorized: result.action !== 'none',
        conversationId: result.conversationId,
        clientMessageId: result.clientMessageId,
      });
    } catch (error) {
      if (
        error instanceof DomainError &&
        ['link_not_found', 'challenge_invalid', 'forbidden'].includes(error.code)
      ) return c.json({ authorized: false });
      throw error;
    }
  });
  app.post('/outbound/outcome', async (c) => {
    const input = await jsonInput(c.req.raw);
    if (
      typeof input.intentId !== 'string' || !/^[a-f\d-]{36}$/i.test(input.intentId) ||
      !['accepted', 'delivered', 'failed', 'uncertain', 'revoked'].includes(String(input.status))
    ) throw new DomainError('invalid_input');
    return c.json(
      await db.command('setup_provider_outbound_record', worker, {
        intentId: input.intentId,
        outcome: input.status,
        providerReference: typeof input.providerMessageId === 'string'
          ? input.providerMessageId.slice(0, 500)
          : undefined,
        errorCode: input.status === 'failed' ? 'provider_failure' : undefined,
        idempotencyKey: await key('outcome', [
          input.intentId,
          input.status,
          input.providerMessageId,
        ]),
      }),
    );
  });
  return app;
}
