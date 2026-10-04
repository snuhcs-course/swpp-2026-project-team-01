import { createDeliveryHandler, type DeliverySnapshot } from './contact.ts';
import type { Environment } from '../../env.ts';
import type { Database } from '../../database.ts';
import { encryptSecret, hashToken } from '../../security.ts';
import type { Job } from '../../../worker/app.ts';
const env: Environment = {
  supabaseUrl: 'https://supabase.example',
  serviceKey: 'secret',
  appOrigin: 'https://findmeatime.com',
  workerSecret: 'x'.repeat(32),
  encryptionKey: btoa('x'.repeat(32)),
  openaiModel: 'gpt-4o-mini-2024-07-18',
  externalSends: false,
  transactionalEmails: true,
  agentmailKey: 'synthetic',
  agentmailInboxId: 'fixture@agentmail.to',
};
const job: Job = {
  id: 'job',
  leaseToken: 'lease',
  kind: 'contact_delivery',
  payload: { outboxId: 'outbox' },
  attempts: 1,
};
const actor = { kind: 'worker' as const, id: 'worker' };
function database(
  snapshot: DeliverySnapshot,
  calls: { operation: string; input: Record<string, unknown> }[],
): Database {
  return {
    command: (operation: string, _actor: unknown, input: Record<string, unknown>) => {
      calls.push({ operation, input });
      if (operation === 'delivery_dispatch') {
        snapshot.encryptedPrepared ||= input.encryptedPrepared as string;
        snapshot.providerInboxId ||= input.providerInboxId as string;
        snapshot.firstDispatchAt ||= new Date().toISOString();
        snapshot.status = 'sending';
      }
      if (operation === 'delivery_record') {
        snapshot.status = input
          .outcome as DeliverySnapshot['status'];
      }
      return Promise.resolve({ ...snapshot });
    },
  } as unknown as Database;
}
Deno.test('disabled contact sends are suppressed without provider access or verified claim', async () => {
  const snapshot: DeliverySnapshot = {
    id: 'outbox',
    dedupeKey: 'contact:challenge',
    status: 'pending',
    recipientEmail: 'requester@example.com',
    payload: { kind: 'contact_verification', requestId: 'request' },
  };
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  let sent = false;
  await createDeliveryHandler(
    { ...env, transactionalEmails: false },
    database(snapshot, calls),
    () => {
      sent = true;
      throw new Error();
    },
  )(job, actor);
  if (
    sent || snapshot.status !== 'suppressed' ||
    calls.some((call) => call.operation === 'contact_confirm')
  ) throw new Error('Disabled send granted authority');
});
Deno.test('uncertain delivery replay retains frozen content and provider idempotency identity', async () => {
  const snapshot: DeliverySnapshot = {
    id: 'outbox',
    dedupeKey: 'contact:challenge',
    status: 'pending',
    recipientEmail: 'requester@example.com',
    payload: {
      kind: 'contact_verification',
      requestId: 'request',
      encryptedSecret: await encryptSecret({ code: 'a'.repeat(43) }, env.encryptionKey!),
    },
  };
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  const observed: string[] = [];
  const db = database(snapshot, calls);
  let attempt = 0;
  const sender = (inbox: string, key: string, email: unknown) => {
    if (!/^[A-Za-z0-9._~-]+$/.test(key)) throw new Error('Invalid provider idempotency key');
    observed.push(JSON.stringify({ inbox, key, email }));
    return Promise.resolve(
      ++attempt === 1
        ? { kind: 'uncertain' as const, code: 'response_lost' }
        : { kind: 'sent' as const, reference: 'same-provider-message' },
    );
  };
  try {
    await createDeliveryHandler(env, db, sender)(job, actor);
  } catch { /* durable job retry */ }
  await createDeliveryHandler(
    { ...env, appOrigin: 'https://new.example.com', agentmailInboxId: 'new@example.com' },
    db,
    sender,
  )(job, actor);
  if (observed.length !== 2 || observed[0] !== observed[1] || snapshot.status !== 'sent') {
    throw new Error('Delivery retry changed immutable identity');
  }
  if (JSON.parse(observed[0]).key !== `fmat-${await hashToken(snapshot.dedupeKey)}`) {
    throw new Error('Provider key changed');
  }
});
Deno.test('inactive contact challenge preserves uncertainty and never resends', async () => {
  const snapshot: DeliverySnapshot = {
    id: 'outbox',
    dedupeKey: 'contact:challenge',
    actionable: false,
    status: 'uncertain',
    recipientEmail: 'requester@example.com',
    payload: { kind: 'contact_verification', requestId: 'request' },
  };
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  await createDeliveryHandler(env, database(snapshot, calls), () => {
    throw new Error('Unexpected send');
  })(job, actor);
  if (
    snapshot.status !== 'uncertain' || calls.length !== 1 || calls[0].operation !== 'delivery_load'
  ) throw new Error('Inactive delivery mutated');
});
Deno.test('disabling sends after dispatch preserves possible delivery as uncertain', async () => {
  const snapshot: DeliverySnapshot = {
    id: 'outbox',
    dedupeKey: 'contact:challenge',
    status: 'uncertain',
    recipientEmail: 'requester@example.com',
    firstDispatchAt: new Date().toISOString(),
    payload: { kind: 'contact_verification', requestId: 'request' },
  };
  await createDeliveryHandler(
    { ...env, transactionalEmails: false },
    database(snapshot, []),
    () => {
      throw new Error('Unexpected send');
    },
  )(job, actor);
  if (snapshot.status !== 'uncertain') throw new Error('Possible delivery falsely suppressed');
});
Deno.test('uncertain delivery outside provider retention window never sends again', async () => {
  const snapshot: DeliverySnapshot = {
    id: 'outbox',
    dedupeKey: 'contact:challenge',
    status: 'uncertain',
    recipientEmail: 'requester@example.com',
    payload: { kind: 'contact_recovery', requestId: 'request' },
    firstDispatchAt: new Date(Date.now() - 24 * 3600000).toISOString(),
  };
  let sent = false;
  await createDeliveryHandler(env, database(snapshot, []), () => {
    sent = true;
    throw new Error();
  })(job, actor);
  if (sent || snapshot.status !== 'uncertain') {
    throw new Error('Expired idempotency window blindly resent email');
  }
});
