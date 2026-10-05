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
  cloudflareAccountId: 'a'.repeat(32),
  cloudflareEmailToken: 'cloudflare-token',
  cloudflareEmailFrom: 'notifications@findmeatime.com',
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
Deno.test('uncertain Cloudflare delivery freezes identity and refuses transport replay', async () => {
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
  const sender = (inbox: string, key: string, email: unknown) => {
    observed.push(JSON.stringify({ inbox, key, email }));
    return Promise.resolve({ kind: 'uncertain' as const, code: 'response_lost' });
  };
  try {
    await createDeliveryHandler(env, db, sender)(job, actor);
  } catch { /* durable job retry */ }
  await createDeliveryHandler(
    { ...env, appOrigin: 'https://new.example.com' },
    db,
    sender,
  )(job, actor);
  const first = JSON.parse(observed[0]);
  if (
    observed.length !== 1 || first.key !== '' ||
    first.inbox !== `cloudflare:${'a'.repeat(32)}:notifications@findmeatime.com` ||
    snapshot.status !== 'uncertain' ||
    !calls.some((call) =>
      call.operation === 'delivery_record' && call.input.errorCode === 'email_replay_unsafe'
    )
  ) {
    throw new Error('Cloudflare delivery was replayed or changed identity');
  }
});

Deno.test('legacy AgentMail retry retains frozen inbox, payload, and idempotency identity', async () => {
  const prepared = {
    to: ['requester@example.com'],
    subject: 'Verify',
    text: 'Frozen legacy content',
  };
  const snapshot: DeliverySnapshot = {
    id: 'outbox',
    dedupeKey: 'contact:legacy',
    status: 'uncertain',
    recipientEmail: 'requester@example.com',
    payload: { kind: 'contact_verification', requestId: 'request' },
    encryptedPrepared: await encryptSecret(prepared, env.encryptionKey!),
    providerInboxId: 'legacy@agentmail.to',
    firstDispatchAt: new Date().toISOString(),
  };
  let observed = '';
  await createDeliveryHandler(
    { ...env, agentmailInboxId: 'new@agentmail.to' },
    database(snapshot, []),
    (inbox, key, email) => {
      observed = JSON.stringify({ inbox, key, email });
      return Promise.resolve({ kind: 'sent', reference: 'legacy-message' });
    },
  )(job, actor);
  if (
    observed !== JSON.stringify({
        inbox: 'legacy@agentmail.to',
        key: `fmat-${await hashToken(snapshot.dedupeKey)}`,
        email: prepared,
      }) || snapshot.status !== 'sent'
  ) throw new Error('Legacy AgentMail retry changed frozen delivery identity');
});

Deno.test('fresh delivery fails closed when Cloudflare configuration is missing', async () => {
  const snapshot: DeliverySnapshot = {
    id: 'outbox',
    dedupeKey: 'contact:missing-config',
    status: 'pending',
    recipientEmail: 'requester@example.com',
    payload: {
      kind: 'contact_verification',
      requestId: 'request',
      encryptedSecret: await encryptSecret({ code: 'a'.repeat(43) }, env.encryptionKey!),
    },
  };
  let sent = false;
  let error = '';
  try {
    await createDeliveryHandler(
      { ...env, cloudflareEmailToken: undefined },
      database(snapshot, []),
      () => {
        sent = true;
        throw new Error();
      },
    )(job, actor);
  } catch (failure) {
    error = (failure as { code?: string }).code || '';
  }
  if (sent || error !== 'provider_unavailable' || snapshot.providerInboxId) {
    throw new Error('Missing Cloudflare configuration fell back or froze an invalid sender');
  }
});

Deno.test('fresh delivery rejects malformed Cloudflare identity before persistence', async () => {
  const snapshot: DeliverySnapshot = {
    id: 'outbox',
    dedupeKey: 'contact:malformed-config',
    status: 'pending',
    recipientEmail: 'requester@example.com',
    payload: {
      kind: 'contact_verification',
      requestId: 'request',
      encryptedSecret: await encryptSecret({ code: 'a'.repeat(43) }, env.encryptionKey!),
    },
  };
  let error = '';
  try {
    await createDeliveryHandler(
      { ...env, cloudflareAccountId: 'not-an-account-id' },
      database(snapshot, []),
    )(job, actor);
  } catch (failure) {
    error = (failure as { code?: string }).code || '';
  }
  if (error !== 'provider_unavailable' || snapshot.firstDispatchAt || snapshot.providerInboxId) {
    throw new Error('Malformed Cloudflare identity reached dispatch');
  }
});

Deno.test('corrupted dispatched delivery cannot be migrated to Cloudflare', async () => {
  const snapshot: DeliverySnapshot = {
    id: 'outbox',
    dedupeKey: 'contact:corrupt-dispatch',
    status: 'sending',
    recipientEmail: 'requester@example.com',
    payload: {
      kind: 'contact_verification',
      requestId: 'request',
      encryptedSecret: await encryptSecret({ code: 'a'.repeat(43) }, env.encryptionKey!),
    },
    firstDispatchAt: new Date().toISOString(),
  };
  let sent = false;
  let error = '';
  try {
    await createDeliveryHandler(env, database(snapshot, []), () => {
      sent = true;
      throw new Error();
    })(job, actor);
  } catch (failure) {
    error = (failure as { code?: string }).code || '';
  }
  if (sent || error !== 'invalid_state' || snapshot.providerInboxId) {
    throw new Error('Corrupted dispatch was treated as a fresh delivery');
  }
});

Deno.test('frozen Cloudflare identity rejects configuration changes before sending', async () => {
  const snapshot: DeliverySnapshot = {
    id: 'outbox',
    dedupeKey: 'contact:changed-config',
    status: 'pending',
    recipientEmail: 'requester@example.com',
    payload: { kind: 'contact_verification', requestId: 'request' },
    encryptedPrepared: await encryptSecret({
      to: ['requester@example.com'],
      subject: 'Verify',
      text: 'Frozen',
    }, env.encryptionKey!),
    providerInboxId: `cloudflare:${'b'.repeat(32)}:notifications@findmeatime.com`,
  };
  let sent = false;
  let error = '';
  try {
    await createDeliveryHandler(env, database(snapshot, []), () => {
      sent = true;
      throw new Error();
    })(job, actor);
  } catch (failure) {
    error = (failure as { code?: string }).code || '';
  }
  if (sent || error !== 'provider_unavailable') {
    throw new Error('Changed Cloudflare identity was silently rerouted');
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
    encryptedPrepared: await encryptSecret({
      to: ['requester@example.com'],
      subject: 'Recover',
      text: 'Frozen legacy content',
    }, env.encryptionKey!),
    providerInboxId: 'legacy@agentmail.to',
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

Deno.test('unknown tagged provider identity is rejected without fallback', async () => {
  const snapshot: DeliverySnapshot = {
    id: 'outbox',
    dedupeKey: 'contact:unknown-provider',
    status: 'pending',
    recipientEmail: 'requester@example.com',
    payload: { kind: 'contact_verification', requestId: 'request' },
    encryptedPrepared: await encryptSecret({
      to: ['requester@example.com'],
      subject: 'Verify',
      text: 'Frozen',
    }, env.encryptionKey!),
    providerInboxId: 'resend:legacy-sender',
  };
  let sent = false;
  let error = '';
  try {
    await createDeliveryHandler(env, database(snapshot, []), () => {
      sent = true;
      throw new Error();
    })(job, actor);
  } catch (failure) {
    error = (failure as { code?: string }).code || '';
  }
  if (sent || error !== 'invalid_state') throw new Error('Unknown provider identity fell back');
});

Deno.test('booking delivery remains governed by the external sends flag', async () => {
  const snapshot: DeliverySnapshot = {
    id: 'outbox',
    dedupeKey: 'booking:disabled',
    status: 'pending',
    recipientEmail: 'requester@example.com',
    payload: { type: 'booking_confirmed', requestId: 'request' },
  };
  let sent = false;
  await createDeliveryHandler(env, database(snapshot, []), () => {
    sent = true;
    throw new Error();
  })(job, actor);
  if (sent || snapshot.status !== 'suppressed') {
    throw new Error('External sends flag did not suppress booking mail');
  }
});
