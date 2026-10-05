import { instant } from '../../_shared/modules/scheduling/time.ts';
// deno-lint-ignore no-import-prefix
import { Hono } from 'npm:hono@4.13.13';
import { actorFor, type Database } from '../../_shared/database.ts';
import type { Environment } from '../../_shared/env.ts';
import { DomainError } from '../../_shared/errors.ts';
import { encryptSecret, hashToken, jsonInput, retryToken } from '../../_shared/security.ts';
import { createEvaluator } from '../../_shared/modules/requests/evaluation.ts';
import { createIntentExtractor, type SchedulingIntent } from '../../_shared/providers/model.ts';
import { travelAllowanceContext } from '../../_shared/modules/scheduling/index.ts';
import { mutationKey } from './onboarding.ts';
import type { RequestView } from '../../../../packages/contracts/index.ts';
type ConversationReviewPatch = Partial<
  Pick<RequestView['details'], 'purpose' | 'mode' | 'location' | 'windows'>
>;
export interface ConversationReview {
  reviewedRevision: number;
  clarification: string;
  patch: ConversationReviewPatch;
}
function conversationPatch(
  intent: SchedulingIntent,
  current: RequestView['details'],
): ConversationReviewPatch {
  const patch: ConversationReviewPatch = {};
  if (intent.purpose !== null && intent.purpose !== current.purpose) patch.purpose = intent.purpose;
  if (intent.mode !== null && intent.mode !== current.mode) patch.mode = intent.mode;
  if (intent.location !== null && intent.location !== current.location) {
    patch.location = intent.location;
  }
  if (
    intent.windows.length &&
    JSON.stringify(intent.windows) !== JSON.stringify(current.windows)
  ) patch.windows = intent.windows;
  return patch;
}
function reviewedPatch(input: unknown, current: RequestView['details']): ConversationReviewPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainError('invalid_input');
  }
  const value = input as Record<string, unknown>;
  const allowed = ['location', 'mode', 'purpose', 'windows'];
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !allowed.includes(key))) {
    throw new DomainError('invalid_input');
  }
  const patch: ConversationReviewPatch = {};
  if ('purpose' in value) {
    if (
      typeof value.purpose !== 'string' || value.purpose.trim().length < 5 ||
      value.purpose.length > 2000
    ) throw new DomainError('invalid_input');
    patch.purpose = value.purpose.trim();
  }
  if ('mode' in value) {
    if (!['online', 'in_person'].includes(String(value.mode))) {
      throw new DomainError('invalid_input');
    }
    patch.mode = value.mode as 'online' | 'in_person';
  }
  if ('location' in value) {
    if (typeof value.location !== 'string' || value.location.length > 500) {
      throw new DomainError('invalid_input');
    }
    patch.location = value.location.trim();
  }
  if ('windows' in value) {
    if (!Array.isArray(value.windows) || !value.windows.length || value.windows.length > 8) {
      throw new DomainError('invalid_input');
    }
    const windows = value.windows as { start?: unknown; end?: unknown }[];
    const invalidWindow = windows.some((window) => {
      if (
        !window || typeof window !== 'object' || Array.isArray(window) ||
        Object.keys(window).some((key) => !['start', 'end'].includes(key)) ||
        typeof window.start !== 'string' || typeof window.end !== 'string'
      ) return true;
      try {
        return instant(window.start) <= Date.now() ||
          instant(window.end) - instant(window.start) < current.durationMinutes * 60000;
      } catch {
        return true;
      }
    });
    if (invalidWindow) throw new DomainError('invalid_input');
    patch.windows = windows as { start: string; end: string }[];
  }
  if ((patch.mode ?? current.mode) === 'in_person' && !(patch.location ?? current.location)) {
    throw new DomainError('invalid_input');
  }
  return patch;
}
export function requestsRoutes(
  env: Environment,
  db: Database,
  evaluator = createEvaluator(env, db),
  extract = createIntentExtractor(env),
) {
  const app = new Hono();
  app.use('/requests/*', async (c, next) => {
    const requestId = c.req.path.split('/')[2];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId || '')) {
      throw new DomainError('invalid_input');
    }
    await next();
  });
  const encryptionKey = () => {
    if (!env.encryptionKey) throw new DomainError('provider_unavailable', 503);
    return env.encryptionKey;
  };
  const worker = () => ({ kind: 'worker' as const, id: crypto.randomUUID() });
  const revision = (input: Record<string, unknown>) => {
    if (!Number.isInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) {
      throw new DomainError('invalid_input');
    }
    return Number(input.expectedRevision);
  };
  app.post('/hosts/:handle/requests', async (c) => {
    const details = await jsonInput(c.req.raw);
    const idempotencyKey = mutationKey(c.req.raw);
    const handle = c.req.param('handle');
    const token = await retryToken(encryptionKey(), 'create-request', {
      handle,
      details,
      idempotencyKey,
    });
    const result = await db.command<RequestView | { request: RequestView }>('request_create', {
      kind: 'public',
    }, { handle, details, tokenHash: await hashToken(token), idempotencyKey });
    const request = 'request' in result ? result.request : result;
    return c.json({ request, token });
  });
  app.get(
    '/host/requests',
    async (c) =>
      c.json(await db.command('requests_list', await actorFor(c.req.raw, db, undefined, true), {})),
  );
  app.get('/requests/:id', async (c) => {
    const requestId = c.req.param('id');
    return c.json(
      await db.command('request_read', await actorFor(c.req.raw, db, requestId), { requestId }),
    );
  });
  app.post('/requests/:id/messages', async (c) => {
    const requestId = c.req.param('id');
    const actor = await actorFor(c.req.raw, db, requestId);
    const input = await jsonInput(c.req.raw);
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000) {
      throw new DomainError('invalid_input');
    }
    const idempotencyKey = mutationKey(c.req.raw);
    const request = await db.command<RequestView>('message_add', actor, {
      requestId,
      text: input.text,
      expectedRevision: revision(input),
      idempotencyKey,
    });
    if (actor.kind !== 'guest' || !env.openaiKey) return c.json(request);
    try {
      const budget = await db.command<{ allowed: boolean }>('model_claim', worker(), {
        requestId,
        expectedRevision: request.revision,
      });
      if (!budget.allowed) return c.json(await db.command('request_read', actor, { requestId }));
      const intent = await extract(input.text, request.details);
      if (!intent) return c.json(request);
      const patch = conversationPatch(intent, request.details);
      const text = intent.intent === 'availability' || intent.intent === 'details'
        ? Object.keys(patch).length
          ? 'I found scheduling details to review. Check each proposed change below before applying it.'
          : intent.clarification
        : intent.intent === 'question'
        ? 'Choose from the evaluated times, or update the availability fields to search again. Agreement and host approval are separate steps.'
        : 'Please provide the meeting purpose, availability, timezone, mode and location in the meeting details.';
      const saved = await db.command<RequestView>('assistant_message_save', worker(), {
        requestId,
        expectedRevision: request.revision,
        text,
        extraction: intent,
        idempotencyKey: `${idempotencyKey}_assistant`,
      });
      return c.json({
        ...saved,
        ...(Object.keys(patch).length
          ? {
            conversationReview: {
              reviewedRevision: saved.revision,
              clarification: intent.clarification,
              patch,
            } satisfies ConversationReview,
          }
          : {}),
      });
    } catch (error) {
      if (
        !(error instanceof DomainError) ||
        !['stale_revision', 'revision_conflict', 'stale_evaluation'].includes(error.code)
      ) throw error;
      return c.json(await db.command('request_read', actor, { requestId }));
    }
  });
  app.post('/requests/:id/conversation-review', async (c) => {
    const requestId = c.req.param('id');
    const actor = await actorFor(c.req.raw, db, requestId);
    if (actor.kind !== 'guest') throw new DomainError('forbidden', 403);
    const input = await jsonInput(c.req.raw);
    const expectedRevision = revision(input);
    if (
      input.confirmed !== true || !Number.isInteger(input.reviewedRevision) ||
      Number(input.reviewedRevision) !== expectedRevision
    ) throw new DomainError('human_confirmation_required');
    const idempotencyKey = mutationKey(c.req.raw);
    const clientInput = {
      requestId,
      expectedRevision,
      reviewedRevision: input.reviewedRevision,
      confirmed: true,
      patch: input.patch,
    };
    const replay = await db.command<{ found: boolean; result?: RequestView }>(
      'mutation_replay',
      actor,
      { requestId, operation: 'details_update', idempotencyKey, clientInput },
    );
    if (replay.found) return c.json(replay.result);
    const request = await db.command<RequestView>('request_read', actor, { requestId });
    if (request.revision !== expectedRevision) throw new DomainError('revision_conflict', 409);
    const patch = reviewedPatch(input.patch, request.details);
    return c.json(
      await db.command('details_update', actor, {
        requestId,
        details: { ...request.details, ...patch },
        expectedRevision,
        clientInput,
        idempotencyKey,
      }),
    );
  });
  app.post('/requests/:id/details', async (c) => {
    const requestId = c.req.param('id');
    const actor = await actorFor(c.req.raw, db, requestId);
    const input = await jsonInput(c.req.raw);
    return c.json(
      await db.command('details_update', actor, {
        requestId,
        details: input.details,
        expectedRevision: revision(input),
        idempotencyKey: mutationKey(c.req.raw),
      }),
    );
  });
  app.post('/requests/:id/evaluate', async (c) => {
    const requestId = c.req.param('id');
    const actor = await actorFor(c.req.raw, db, requestId);
    const input = await jsonInput(c.req.raw);
    await db.command('request_read', actor, { requestId });
    return c.json(await evaluator.evaluate(requestId, revision(input), mutationKey(c.req.raw)));
  });
  for (const action of ['proposal', 'revise'] as const) {
    app.post(`/requests/:id/${action}`, async (c) => {
      const requestId = c.req.param('id');
      const actor = await actorFor(c.req.raw, db, requestId, action === 'revise');
      const input = await jsonInput(c.req.raw);
      const idempotencyKey = mutationKey(c.req.raw);
      const clientInput = {
        requestId,
        expectedRevision: revision(input),
        start: input.start,
        end: input.end,
        ...(action === 'revise' && input.mode !== undefined ? { mode: input.mode } : {}),
        ...(action === 'revise' && input.location !== undefined
          ? { location: input.location }
          : {}),
      };
      const replay = await db.command<{ found: boolean; result?: unknown }>(
        'mutation_replay',
        actor,
        {
          requestId,
          operation: action === 'revise' ? 'proposal_revise' : 'proposal_create',
          idempotencyKey,
          clientInput,
        },
      );
      if (replay.found) return c.json(replay.result);
      await db.command('request_read', actor, { requestId });
      if (typeof input.start !== 'string' || typeof input.end !== 'string') {
        throw new DomainError('invalid_input');
      }
      if (
        action === 'revise' &&
        ((input.mode !== undefined && !['online', 'in_person'].includes(String(input.mode))) ||
          (input.location !== undefined &&
            (typeof input.location !== 'string' || input.location.length > 500)))
      ) {
        throw new DomainError('invalid_input');
      }
      const override = action === 'revise'
        ? {
          ...(input.mode ? { mode: input.mode as 'online' | 'in_person' } : {}),
          ...(input.location !== undefined ? { location: input.location as string } : {}),
        }
        : undefined;
      const evidence = await evaluator.validate(requestId, revision(input), {
        start: input.start,
        end: input.end,
      }, override);
      return c.json(
        await db.command(action === 'revise' ? 'proposal_revise' : 'proposal_create', actor, {
          requestId,
          start: input.start,
          end: input.end,
          ...(override || {}),
          expectedRevision: revision(input),
          validatedEvidence: evidence,
          idempotencyKey: mutationKey(c.req.raw),
        }),
      );
    });
  }
  for (
    const [path, operation, hostOnly] of [
      ['agree', 'requester_agree', false],
      ['withdraw', 'requester_withdraw', false],
      ['decline', 'host_decline', true],
      ['private-messages', 'private_note_save', true],
    ] as const
  ) {
    app.post(`/requests/:id/${path}`, async (c) => {
      const requestId = c.req.param('id');
      const actor = await actorFor(c.req.raw, db, requestId, hostOnly);
      const input = await jsonInput(c.req.raw);
      if (
        path === 'private-messages' &&
        (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000)
      ) throw new DomainError('invalid_input');
      return c.json(
        await db.command(operation, actor, {
          requestId,
          expectedRevision: revision(input),
          ...(path === 'agree' ? { proposalVersion: input.proposalVersion } : {}),
          ...(path === 'private-messages' ? { text: input.text } : {}),
          idempotencyKey: mutationKey(c.req.raw),
        }),
      );
    });
  }
  app.post('/requests/:id/verification/start', async (c) => {
    const requestId = c.req.param('id');
    const actor = await actorFor(c.req.raw, db, requestId);
    if (actor.kind !== 'guest') throw new DomainError('forbidden', 403);
    const input = await jsonInput(c.req.raw);
    const idempotencyKey = mutationKey(c.req.raw);
    const code = await retryToken(encryptionKey(), 'verify-contact', {
      requestId,
      expectedRevision: revision(input),
      idempotencyKey,
    });
    const request = await db.command('contact_start', actor, {
      requestId,
      expectedRevision: revision(input),
      codeHash: await hashToken(code),
      encryptedCode: await encryptSecret({ code }, encryptionKey()),
      idempotencyKey,
    });
    return c.json({ status: 'pending', request });
  });
  app.post('/requests/:id/verification/confirm', async (c) => {
    const requestId = c.req.param('id');
    const actor = await actorFor(c.req.raw, db, requestId);
    if (actor.kind !== 'guest') throw new DomainError('forbidden', 403);
    const input = await jsonInput(c.req.raw);
    if (typeof input.code !== 'string' || input.code.trim().length !== 43) {
      throw new DomainError('invalid_input');
    }
    return c.json(
      await db.command('contact_confirm', actor, {
        requestId,
        codeHash: await hashToken(input.code.trim()),
        expectedRevision: revision(input),
        idempotencyKey: mutationKey(c.req.raw),
      }),
    );
  });
  app.post('/requests/:id/recover', async (c) => {
    const requestId = c.req.param('id');
    const input = await jsonInput(c.req.raw);
    if (typeof input.email !== 'string' || input.email.length > 254) {
      throw new DomainError('invalid_input');
    }
    const idempotencyKey = mutationKey(c.req.raw);
    const email = input.email.trim().toLowerCase();
    const token = await retryToken(encryptionKey(), 'recover-contact', {
      requestId,
      email,
      idempotencyKey,
    });
    try {
      await db.command('contact_recover', { kind: 'public' }, {
        requestId,
        email,
        tokenHash: await hashToken(token),
        encryptedToken: await encryptSecret({ token }, encryptionKey()),
        idempotencyKey,
      });
    } catch (error) {
      if (
        !(error instanceof DomainError) ||
        !['not_found', 'request_closed', 'request_expired', 'rate_limited'].includes(error.code)
      ) throw error;
    }
    return c.json({ status: 'pending' });
  });
  app.post('/requests/:id/recovery/redeem', async (c) => {
    const requestId = c.req.param('id');
    const input = await jsonInput(c.req.raw);
    if (typeof input.token !== 'string' || input.token.length !== 43) {
      throw new DomainError('invalid_input');
    }
    const idempotencyKey = mutationKey(c.req.raw);
    const token = await retryToken(encryptionKey(), 'redeem-contact', {
      requestId,
      recoveryToken: input.token,
      idempotencyKey,
    });
    const request = await db.command('contact_redeem', { kind: 'public' }, {
      requestId,
      tokenHash: await hashToken(input.token),
      newTokenHash: await hashToken(token),
      idempotencyKey,
    });
    return c.json({ request, token });
  });
  app.post('/requests/:id/context', async (c) => {
    const requestId = c.req.param('id');
    const actor = await actorFor(c.req.raw, db, requestId, true);
    const input = await jsonInput(c.req.raw);
    if (
      !Array.isArray(input.physicalContext) || input.physicalContext.length > 10 ||
      input.physicalContext.some((context) =>
        !context || typeof context.at !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(context.at) ||
        !Number.isFinite(Date.parse(context.at)) || typeof context.location !== 'string' ||
        !context.location.trim() || context.location.length > 500
      ) ||
      (input.candidatePhysicalLocation !== undefined &&
        (typeof input.candidatePhysicalLocation !== 'string' ||
          input.candidatePhysicalLocation.length > 500))
    ) throw new DomainError('invalid_input');
    return c.json(
      await db.command('private_context_save', actor, {
        requestId,
        physicalContext: input.physicalContext.map(({ at, location }) => ({ at, location })),
        candidatePhysicalLocation: input.candidatePhysicalLocation,
        expectedRevision: revision(input),
        idempotencyKey: mutationKey(c.req.raw),
      }),
    );
  });
  app.post('/requests/:id/preference-exception', async (c) => {
    const requestId = c.req.param('id');
    const actor = await actorFor(c.req.raw, db, requestId, true);
    const input = await jsonInput(c.req.raw);
    if (
      input.confirmed !== true || !Number.isInteger(input.proposalVersion) ||
      Number(input.proposalVersion) < 1 || typeof input.reason !== 'string' ||
      !input.reason.trim() || input.reason.length > 2000
    ) throw new DomainError('invalid_input');
    const idempotencyKey = mutationKey(c.req.raw);
    const clientInput = {
      requestId,
      expectedRevision: revision(input),
      proposalVersion: input.proposalVersion,
      confirmed: true,
      reason: input.reason.trim(),
    };
    const replay = await db.command<{ found: boolean; result?: unknown }>(
      'mutation_replay',
      actor,
      { requestId, operation: 'preference_exception_save', idempotencyKey, clientInput },
    );
    if (replay.found) return c.json(replay.result);
    const request = await db.command<RequestView>('request_read', actor, { requestId });
    if (!request.proposal || request.proposal.version !== input.proposalVersion) {
      throw new DomainError('proposal_conflict', 409);
    }
    const evidence = await evaluator.validate(requestId, revision(input), request.proposal);
    return c.json(
      await db.command('preference_exception_save', actor, {
        ...clientInput,
        rulesVersion: evidence.rulesVersion,
        idempotencyKey,
      }),
    );
  });
  app.post('/requests/:id/approve', async (c) => {
    const requestId = c.req.param('id');
    const actor = await actorFor(c.req.raw, db, requestId, true);
    const input = await jsonInput(c.req.raw);
    if (
      input.confirmed !== true || !Number.isInteger(input.proposalVersion) ||
      Number(input.proposalVersion) < 1
    ) throw new DomainError('human_confirmation_required');
    return c.json(
      await db.command('host_approve', { ...actor, confirmationSource: 'authenticated_web' }, {
        requestId,
        proposalVersion: input.proposalVersion,
        expectedRevision: revision(input),
        confirmed: true,
        idempotencyKey: mutationKey(c.req.raw),
      }),
    );
  });
  app.post('/requests/:id/travel-allowances', async (c) => {
    const requestId = c.req.param('id');
    const actor = await actorFor(c.req.raw, db, requestId, true);
    const input = await jsonInput(c.req.raw);
    if (
      input.confirmed !== true || !['before', 'after'].includes(String(input.edge)) ||
      !Number.isInteger(input.durationMinutes) || Number(input.durationMinutes) < 1 ||
      Number(input.durationMinutes) > 1440 || typeof input.start !== 'string' ||
      typeof input.end !== 'string'
    ) throw new DomainError('invalid_input');
    const idempotencyKey = mutationKey(c.req.raw);
    const clientInput = {
      requestId,
      expectedRevision: revision(input),
      start: input.start,
      end: input.end,
      edge: input.edge,
      durationMinutes: input.durationMinutes,
      confirmed: input.confirmed,
    };
    const replay = await db.command<{ found: boolean; result?: unknown }>(
      'mutation_replay',
      actor,
      { requestId, operation: 'manual_allowance_save', idempotencyKey, clientInput },
    );
    if (replay.found) return c.json(replay.result);
    await db.command('request_read', actor, { requestId });
    const current = await evaluator.context(requestId, revision(input));
    const context = travelAllowanceContext(
      current.input,
      { start: input.start, end: input.end },
      input.edge as 'before' | 'after',
    );
    if (!context) throw new DomainError('not_feasible', 409);
    const id = await retryToken(encryptionKey(), 'manual-allowance', { requestId, idempotencyKey });
    return c.json(
      await db.command('manual_allowance_save', actor, {
        requestId,
        expectedRevision: revision(input),
        rulesVersion: current.snapshot.rulesVersion,
        confirmed: true,
        clientInput,
        allowance: {
          id,
          hostId: actor.id,
          confirmedAt: new Date().toISOString(),
          durationMinutes: input.durationMinutes,
          context,
        },
        idempotencyKey,
      }),
    );
  });
  return app;
}
