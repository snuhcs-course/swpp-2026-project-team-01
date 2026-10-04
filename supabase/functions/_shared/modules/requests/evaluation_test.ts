import { createEvaluator, type EvaluationSnapshot } from './evaluation.ts';
import type { Environment } from '../../env.ts';
import type { Database } from '../../database.ts';
import { DomainError } from '../../errors.ts';
const slot = { start: '2030-06-01T09:00:00Z', end: '2030-06-01T09:30:00Z' };
const env = { appOrigin: 'https://findmeatime.com' } as Environment;
function snapshot(): EvaluationSnapshot {
  return {
    requestId: 'request',
    hostId: 'host',
    revision: 4,
    rulesVersion: 2,
    requesterConnection: true,
    rules: {
      timezone: 'UTC',
      durationMinutes: 30,
      availability: [{ days: [6], start: '09:00', end: '17:00' }],
      focusBlocks: [],
      bufferMinutes: 0,
      travelMode: 'WALK',
      preferences: '',
    },
    details: {
      requesterName: 'Requester',
      requesterEmail: 'requester@example.com',
      purpose: 'Meet',
      durationMinutes: 30,
      timezone: 'UTC',
      windows: [slot],
      mode: 'online',
      location: 'Host link',
    },
  };
}
const oauth = {
  credential: () =>
    Promise.resolve({
      connection: { conflictCalendarIds: ['work'] },
      credential: { accessToken: 'synthetic' },
    }),
} as unknown as Parameters<typeof createEvaluator>[2];
Deno.test('evaluation reads fresh requester busy and saves only deterministic candidates under CAS', async () => {
  let saved: Record<string, unknown> | undefined;
  let hostRead = 0;
  let requesterRead = 0;
  const db = {
    command: (operation: string, _actor: unknown, input: Record<string, unknown>) => {
      if (operation === 'evaluation_read') return Promise.resolve(snapshot());
      saved = input;
      return Promise.resolve({ candidates: input.candidates });
    },
  } as unknown as Database;
  const calendars = {
    hostEvents: () => {
      hostRead++;
      return Promise.resolve([]);
    },
    requesterBusy: () => {
      requesterRead++;
      return Promise.resolve([slot]);
    },
  } as Parameters<typeof createEvaluator>[3];
  const result = await createEvaluator(env, db, oauth, calendars).evaluate(
    'request',
    4,
    'evaluation-key',
  );
  if (
    hostRead !== 1 || requesterRead !== 1 || result.candidates.length ||
    saved?.expectedRevision !== 4 || saved.rulesVersion !== 2
  ) throw new Error('Fresh busy/CAS lost');
});
Deno.test('requester Calendar failure blocks evaluation instead of saving free availability', async () => {
  let saved = false;
  const db = {
    command: (operation: string) => {
      if (operation === 'evaluation_read') return Promise.resolve(snapshot());
      saved = true;
      throw new Error('Unexpected save');
    },
  } as unknown as Database;
  const calendars = {
    hostEvents: () => Promise.resolve([]),
    requesterBusy: () => Promise.reject(new DomainError('reconnect_required', 409)),
  } as Parameters<typeof createEvaluator>[3];
  let rejected = false;
  try {
    await createEvaluator(env, db, oauth, calendars).evaluate('request', 4, 'evaluation-key');
  } catch (error) {
    rejected = error instanceof DomainError && error.code === 'reconnect_required';
  }
  if (!rejected || saved) throw new Error('Unavailable requester calendar allowed candidates');
});
Deno.test('stale evaluation is rejected before external Calendar access', async () => {
  const db = { command: () => Promise.resolve(snapshot()) } as unknown as Database;
  const provider = {
    credential: () => {
      throw new Error('Unexpected Calendar access');
    },
  } as unknown as Parameters<typeof createEvaluator>[2];
  let rejected = false;
  try {
    await createEvaluator(env, db, provider).context('request', 3);
  } catch (error) {
    rejected = error instanceof DomainError && error.code === 'stale_revision';
  }
  if (!rejected) throw new Error('Stale revision reached provider');
});
Deno.test('ranking uses request model budget and preserves rules/revision CAS', async () => {
  const value = snapshot();
  value.requesterConnection = false;
  value.rules.preferences = 'Prefer later';
  value.details.windows = [{ start: slot.start, end: '2030-06-01T10:00:00Z' }];
  let claimed = false;
  let saved: Record<string, unknown> | undefined;
  const db = {
    command: (operation: string, _actor: unknown, input: Record<string, unknown>) => {
      if (operation === 'evaluation_read') return Promise.resolve(value);
      if (operation === 'model_claim') {
        claimed = input.expectedRevision === value.revision;
        return Promise.resolve({ allowed: true });
      }
      saved = input;
      return Promise.reject(new DomainError('revision_conflict', 409));
    },
  } as unknown as Database;
  let ranked = false;
  const evaluator = createEvaluator({ ...env, openaiKey: 'synthetic' }, db, oauth, {
    hostEvents: () => Promise.resolve([]),
    requesterBusy: () => Promise.resolve([]),
  }, {
    rank: (candidates, preferences) => {
      ranked = preferences === value.rules.preferences;
      return Promise.resolve([...candidates].reverse());
    },
  });
  let stale = false;
  try {
    await evaluator.evaluate('request', value.revision, 'evaluation-key');
  } catch (error) {
    stale = error instanceof DomainError && error.code === 'revision_conflict';
  }
  if (
    !claimed || !ranked || !stale || saved?.expectedRevision !== value.revision ||
    saved.rulesVersion !== value.rulesVersion
  ) throw new Error('Ranked stale result bypassed CAS');
});
Deno.test('expired route budget remains unresolved and requests a resolution action', async () => {
  const value = snapshot();
  value.requesterConnection = false;
  value.details.mode = 'in_person';
  value.details.location = 'Meeting';
  value.privateSchedulingContext = {
    physicalContext: [{ at: '2030-06-01T08:00:00Z', location: 'Office' }],
  };
  let saved: Record<string, unknown> | undefined;
  const db = {
    command: (operation: string, _actor: unknown, input: Record<string, unknown>) => {
      if (operation === 'evaluation_read') return Promise.resolve(value);
      saved = input;
      return Promise.resolve({ candidates: input.candidates });
    },
  } as unknown as Database;
  await createEvaluator({ ...env, routesKey: 'synthetic' }, db, oauth, {
    hostEvents: () => Promise.resolve([]),
    requesterBusy: () => Promise.resolve([]),
  }, {
    evaluationMs: 0,
    fetcher: () => {
      throw new Error('Expired budget started provider request');
    },
  }).evaluate('request', 4, 'evaluation-key');
  if (
    !saved?.unresolved ||
    !JSON.stringify(saved.privateDiagnostics).includes('evaluation_unresolved')
  ) throw new Error('Deadline produced false no-match');
});
