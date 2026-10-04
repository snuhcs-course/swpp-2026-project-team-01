/**
 * Opt-in integration against a freshly reset, otherwise idle LOCAL Supabase stack.
 *
 *   supabase status --output json > .local/supabase-status.json
 *   FMAT_LOCAL_INTEGRATION=1 deno run --allow-env=FMAT_LOCAL_INTEGRATION,FMAT_LOCAL_SUPABASE_URL,FMAT_LOCAL_SERVICE_ROLE_KEY,FMAT_LOCAL_STATUS_FILE \
 *     --allow-read=.local --allow-net=127.0.0.1:54321,localhost:54321 scripts/tests/booking-integration.ts
 *
 * Every network request targets localhost:54321. Google and delivery are injected fixtures;
 * no OAuth consent, Calendar event, email, or live-provider success is claimed. Fixtures use
 * real service-only SQL commands, not direct table writes. They remain in the disposable DB
 * for inspection; this script never resets/deletes data or modifies production.
 */
import type { Actor, Database } from '../../supabase/functions/_shared/database.ts';
import { createBookingRuntime } from '../../supabase/functions/_shared/modules/booking_runtime/index.ts';
import type { Environment } from '../../supabase/functions/_shared/env.ts';
import { encryptSecret } from '../../supabase/functions/_shared/security.ts';
import type { Fetcher } from '../../supabase/functions/_shared/providers/transport.ts';
import { createEvaluator } from '../../supabase/functions/_shared/modules/requests/evaluation.ts';
import { DomainError } from '../../supabase/functions/_shared/errors.ts';
import type {
  BookingAttempt,
  BookingJob,
  ProviderEvent,
} from '../../supabase/functions/_shared/modules/booking/index.ts';
import { evaluateSlot } from '../../supabase/functions/_shared/modules/scheduling/index.ts';
import type { HostRules, MeetingDetails, RequestView } from '../../packages/contracts/index.ts';

type ClaimedJob = BookingJob & { kind: string; attempts: number };
type EvaluationContext = {
  requestId: string;
  hostId: string;
  revision: number;
  rulesVersion: number;
  rules: HostRules;
  details: MeetingDetails;
};
class RpcFailure extends Error {
  constructor(public operation: string, public code: string) {
    super(`${operation}: ${code}`);
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function expectFailure(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    assert(
      error instanceof RpcFailure && error.code === code,
      `Expected ${code}, received ${error instanceof RpcFailure ? error.code : 'non-RPC failure'}`,
    );
    return;
  }
  throw new Error(`Expected rejection: ${code}`);
}
async function digest(value: string): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function main() {
  assert(
    Deno.env.get('FMAT_LOCAL_INTEGRATION') === '1',
    'Set FMAT_LOCAL_INTEGRATION=1 explicitly for this disposable local integration test.',
  );
  let configuredUrl = Deno.env.get('FMAT_LOCAL_SUPABASE_URL');
  let serviceKey = Deno.env.get('FMAT_LOCAL_SERVICE_ROLE_KEY');
  if (!configuredUrl || !serviceKey) {
    const status: Record<string, unknown> = JSON.parse(
      await Deno.readTextFile(
        Deno.env.get('FMAT_LOCAL_STATUS_FILE') || '.local/supabase-status.json',
      ),
    );
    configuredUrl ||= String(status.API_URL || status.api_url || '');
    serviceKey ||= String(status.SERVICE_ROLE_KEY || status.service_role_key || '');
  }
  const local = new URL(configuredUrl);
  assert(
    local.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(local.hostname) &&
      local.port === '54321' && !local.username && !local.password && local.pathname === '/' &&
      !local.search && !local.hash,
    'Refusing any endpoint except http://localhost:54321 or http://127.0.0.1:54321.',
  );
  assert(
    serviceKey.length > 20,
    'A local service-role key is required; never use the production .env file.',
  );
  const deadline = Date.now() + 60_000;
  const database: Database = {
    async command<T>(operation: string, actor: Actor, input: Record<string, unknown>): Promise<T> {
      assert(Date.now() < deadline, 'Local integration exceeded its 60-second budget.');
      const response = await fetch(new URL('/rest/v1/rpc/fmat_command', local), {
        method: 'POST',
        headers: {
          apikey: serviceKey!,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_operation: operation,
          p_actor: actor,
          p_input: { idempotencyKey: crypto.randomUUID(), ...input },
        }),
        signal: AbortSignal.timeout(Math.min(15_000, deadline - Date.now())),
        redirect: 'error',
      });
      const data = await response.json();
      if (!response.ok) {
        // SQL machine codes only: never print request data, credentials, or arbitrary error bodies.
        const code = typeof data.message === 'string' && /^[A-Z_]+$/.test(data.message)
          ? data.message
          : 'RPC_FAILED';
        throw new RpcFailure(operation, code);
      }
      return data as T;
    },
    host() {
      throw new Error(
        'This test uses synthetic trusted service actors, not browser authentication.',
      );
    },
  };
  const runId = crypto.randomUUID();
  const environment: Environment = {
    supabaseUrl: local.origin,
    serviceKey,
    appOrigin: local.origin,
    workerSecret: 'local-fixture-worker-secret-no-remote-access',
    encryptionKey: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
    googleClientId: 'local-client-no-live-oauth',
    googleClientSecret: 'local-secret-no-live-oauth',
    openaiModel: 'local-fixture-no-model-call',
    externalSends: false,
  };
  const hostCredential = {
    accessToken: 'local-host-access',
    refreshToken: 'local-host-refresh',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    scope:
      'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
  };
  const encryptedHostCredential = await encryptSecret(hostCredential, environment.encryptionKey!);
  const operator: Actor = { kind: 'operator', id: `local-integration:${runId}` };
  const worker = { kind: 'worker' as const, id: `local-worker:${runId}` };
  const host: Actor & { confirmationSource?: string } = {
    kind: 'host',
    id: crypto.randomUUID(),
    email: `host-${runId}@example.invalid`,
    confirmationSource: 'authenticated_web',
  };
  const handle = `test-${runId.slice(0, 12)}`;
  const rules: HostRules = {
    timezone: 'UTC',
    durationMinutes: 30,
    availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }],
    focusBlocks: [],
    bufferMinutes: 0,
    travelMode: 'WALK',
    preferences: 'PRIVATE-FIXTURE-DO-NOT-SHARE',
  };
  const invitationHash = await digest(crypto.randomUUID());
  await database.command('invite_issue', operator, {
    email: host.email,
    tokenHash: invitationHash,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await database.command('invite_redeem', host, { tokenHash: invitationHash });
  await database.command('setup_save', host, {
    handle,
    displayName: 'Local Integration Host',
    rules,
  });
  const stateHash = await digest(crypto.randomUUID()),
    bindingHash = await digest(crypto.randomUUID());
  const exchange = await database.command<{ exchangeId: string }>('oauth_start', host, {
    stateHash,
    bindingHash,
    encryptedVerifier: 'local-fixture-ciphertext-no-live-oauth',
    context: { redirectUri: 'http://127.0.0.1:54321/local-fixture' },
  });
  await database.command('oauth_consume', { kind: 'public' }, { stateHash, bindingHash });
  await database.command('credential_save', worker, {
    exchangeId: exchange.exchangeId,
    providerSubject: `local-google:${runId}`,
    encryptedCredential: encryptedHostCredential,
    scopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ],
  });
  const calendarId = `local-calendar:${runId}`;
  const conflictCalendarId = `local-conflicts:${runId}`;
  await database.command('calendar_save', host, {
    conflictCalendarIds: [conflictCalendarId],
    bookingCalendarId: calendarId,
    verifiedCalendars: [{ id: calendarId, accessRole: 'owner' }, {
      id: conflictCalendarId,
      accessRole: 'reader',
    }],
  });

  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 2);
  start.setUTCHours(12, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60_000);
  const tokenHash = await digest(crypto.randomUUID());
  let request = await database.command<RequestView>('request_create', { kind: 'public' }, {
    handle,
    tokenHash,
    details: {
      requesterName: 'Local Requester',
      requesterEmail: `guest-${runId}@example.invalid`,
      purpose: 'Integration fixture, no live invitation',
      durationMinutes: 30,
      timezone: 'UTC',
      mode: 'online',
      location: 'https://meet.example.invalid/controlled-fixture',
      windows: [{
        start: start.toISOString(),
        end: new Date(start.getTime() + 3_600_000).toISOString(),
      }],
    },
  });
  const requestId = request.id;
  const guest: Actor = { kind: 'guest', requestId, tokenHash };
  const messageInput = {
    requestId,
    expectedRevision: request.revision,
    text: 'I agree to review this controlled meeting proposal.',
    idempotencyKey: crypto.randomUUID(),
  };
  request = await database.command<RequestView>('message_add', guest, messageInput);
  const replay = await database.command<RequestView>('message_add', guest, messageInput);
  assert(
    replay.revision === request.revision && replay.messages.length === request.messages.length,
    'Repeated requester message must replay without a duplicate transition.',
  );
  const codeHash = await digest('synthetic-local-verification-code');
  request = await database.command<RequestView>('contact_start', guest, {
    requestId,
    expectedRevision: request.revision,
    codeHash,
    encryptedCode: 'local-fixture-ciphertext-no-email-send',
  });
  request = await database.command<RequestView>('contact_confirm', guest, {
    requestId,
    expectedRevision: request.revision,
    codeHash,
  });
  const guestState = await digest(crypto.randomUUID());
  const guestBinding = await digest(crypto.randomUUID());
  const guestExchange = await database.command<{ exchangeId: string }>('oauth_start', guest, {
    stateHash: guestState,
    bindingHash: guestBinding,
    encryptedVerifier: 'local-requester-fixture-no-oauth-provider',
    context: { redirectUri: 'http://127.0.0.1:54321/local-fixture', requestId },
  });
  await database.command('oauth_consume', { kind: 'public' }, {
    stateHash: guestState,
    bindingHash: guestBinding,
  });
  await database.command('credential_save', worker, {
    exchangeId: guestExchange.exchangeId,
    providerSubject: `local-requester-google:${runId}`,
    encryptedCredential: await encryptSecret({
      ...hostCredential,
      accessToken: 'local-requester-access',
      scope: 'https://www.googleapis.com/auth/calendar.freebusy',
    }, environment.encryptionKey!),
    scopes: ['https://www.googleapis.com/auth/calendar.freebusy'],
  });
  request = await database.command<RequestView>('request_read', guest, { requestId });
  const context = await database.command<EvaluationContext>('evaluation_read', worker, {
    requestId,
  });
  const slot = { start: start.toISOString(), end: end.toISOString() };
  assert(
    (await evaluateSlot({
      rules: context.rules,
      details: context.details,
      hostEvents: [],
      requesterBusy: [],
    }, slot)).feasible,
    'Synthetic calendars must produce a genuinely evaluated feasible slot.',
  );
  request = await database.command<RequestView>('candidates_save', worker, {
    requestId,
    expectedRevision: context.revision,
    rulesVersion: context.rulesVersion,
    candidates: [slot],
    privateDiagnostics: [],
    privateTravelChecks: [],
  });
  request = await database.command<RequestView>('proposal_create', guest, {
    requestId,
    expectedRevision: request.revision,
    ...slot,
  });
  assert(request.proposal, 'Proposal creation must return the persisted version.');
  request = await database.command<RequestView>('requester_agree', guest, {
    requestId,
    expectedRevision: request.revision,
    proposalVersion: request.proposal.version,
  });
  const approval = {
    requestId,
    expectedRevision: request.revision,
    proposalVersion: request.proposal!.version,
    confirmed: true,
  };
  await expectFailure(() => database.command('host_approve', guest, approval), 'UNAUTHORIZED');
  const { confirmationSource: _source, ...unattributedHost } = host;
  await expectFailure(
    () => database.command('host_approve', unattributedHost, approval),
    'HUMAN_CONFIRMATION_REQUIRED',
  );
  await expectFailure(
    () =>
      database.command('host_approve', host, {
        ...approval,
        expectedRevision: request.revision - 1,
      }),
    'STALE_REVISION',
  );
  await expectFailure(
    () =>
      database.command('host_approve', host, {
        ...approval,
        proposalVersion: approval.proposalVersion + 1,
      }),
    'PROPOSAL_STALE',
  );
  request = await database.command<RequestView>('host_approve', host, approval);
  assert(
    request.status === 'booking' && !request.event,
    'Human approval must report pending booking before provider evidence.',
  );

  const claim = async () =>
    (await database.command<{ jobs: ClaimedJob[] }>('jobs_claim', worker, {
      workerId: worker.id,
      limit: 10,
    })).jobs;
  const complete = (job: ClaimedJob) =>
    database.command('jobs_complete', worker, { jobId: job.id, leaseToken: job.leaseToken });
  const initialJobs = await claim();
  const bookingJob = initialJobs.find((job) =>
    job.kind === 'booking' && job.payload.requestId === requestId
  );
  assert(bookingJob, 'Host approval must publish a claimable real booking job.');
  for (const job of initialJobs.filter((job) => job.kind === 'contact_delivery')) {
    const delivery = await database.command<{
      status: string;
      payload: Record<string, unknown>;
    }>('delivery_load', worker, {
      jobId: job.id,
      leaseToken: job.leaseToken,
      outboxId: job.payload.outboxId,
    });
    if (delivery.payload.requestId !== requestId) continue;
    assert(
      delivery.status === 'suppressed',
      'Consumed contact fixtures must suppress pending sends.',
    );
    await complete(job);
  }
  const providerEvents = new Map<string, ProviderEvent>();
  const calendarReads = new Set<string>();
  let inserts = 0, lookups = 0, requesterReads = 0, invisibleOnce = true;
  let exposeProviderReceipt = false;
  let frozenEventId: string | undefined;
  const providerFetcher: Fetcher = (input, init) => {
    // This transport never delegates to fetch: even unexpected provider calls fail locally.
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(
      init?.headers || (input instanceof Request ? input.headers : undefined),
    );
    assert(url.hostname === 'www.googleapis.com', 'Unexpected injected provider hostname.');
    if (url.pathname === '/calendar/v3/users/me/calendarList' && method === 'GET') {
      assert(
        headers.get('authorization') === 'Bearer local-host-access',
        'Calendar list must use the host grant.',
      );
      return Promise.resolve(Response.json({
        items: [
          { id: calendarId, summary: 'Local booking fixture', accessRole: 'owner' },
          { id: conflictCalendarId, summary: 'Local conflict fixture', accessRole: 'reader' },
        ],
      }));
    }
    if (url.pathname === '/calendar/v3/freeBusy' && method === 'POST') {
      requesterReads++;
      assert(
        headers.get('authorization') === 'Bearer local-requester-access',
        'Requester busy must use the request-bound read-only grant.',
      );
      return Promise.resolve(Response.json({ calendars: { primary: { busy: [] } } }));
    }
    const eventCollection = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const conflictCollection = `/calendar/v3/calendars/${
      encodeURIComponent(conflictCalendarId)
    }/events`;
    if (
      (url.pathname === eventCollection || url.pathname === conflictCollection) && method === 'GET'
    ) {
      calendarReads.add(url.pathname === eventCollection ? calendarId : conflictCalendarId);
      return Promise.resolve(Response.json({
        items: exposeProviderReceipt && url.pathname === eventCollection
          ? [...providerEvents.values()]
          : [],
      }));
    }
    if (url.pathname === eventCollection && method === 'POST') {
      inserts++;
      assert(
        headers.get('authorization') === 'Bearer local-host-access' &&
          url.searchParams.get('sendUpdates') === 'all',
        'Only the host grant may insert the frozen event with the agreed Google attendee policy.',
      );
      const payload = JSON.parse(String(init?.body)) as BookingAttempt['payload'];
      frozenEventId = payload.id;
      assert(
        !JSON.stringify(payload).includes('PRIVATE-FIXTURE'),
        'Frozen Google payload excludes host private context.',
      );
      providerEvents.set(`${calendarId}/${payload.id}`, {
        ...payload,
        status: 'confirmed',
        htmlLink: 'https://www.google.com/calendar/event?eid=local-fixture',
      });
      return Promise.reject(new Error('INJECTED: provider accepted, response lost'));
    }
    if (url.pathname.startsWith(eventCollection + '/') && method === 'GET') {
      lookups++;
      const eventId = decodeURIComponent(url.pathname.slice(eventCollection.length + 1));
      assert(
        eventId === frozenEventId,
        'Every reconciliation must GET the original frozen event ID.',
      );
      if (invisibleOnce) {
        invisibleOnce = false;
        return Promise.resolve(Response.json({ error: 'not found' }, { status: 404 }));
      }
      const event = providerEvents.get(`${calendarId}/${eventId}`);
      assert(event, 'Synthetic provider event must remain saved under its original identity.');
      return Promise.resolve(Response.json(event));
    }
    throw new Error('Unexpected injected provider method or path.');
  };
  const runtime = createBookingRuntime(environment, database, { fetcher: providerFetcher });
  const execute = runtime.handler;
  let snapshot = await database.command<BookingAttempt>('booking_load', worker, {
    jobId: bookingJob.id,
    leaseToken: bookingJob.leaseToken,
    requestId,
  });
  const beforeCredentialRace = await runtime.revalidate(snapshot);
  assert(
    beforeCredentialRace.allowed,
    'Actual runtime must revalidate encrypted grants, provider permissions, host/requester calendars and feasibility.',
  );
  const connection = await database.command<{
    connectionId: string;
    updatedAt: string;
    providerSubject: string;
  }>('connection_read', worker, { hostId: host.id });
  await database.command('token_update', worker, {
    connectionId: connection.connectionId,
    expectedUpdatedAt: connection.updatedAt,
    providerSubject: connection.providerSubject,
    encryptedCredential: encryptedHostCredential,
  });
  await expectFailure(() =>
    database.command('booking_dispatch', worker, {
      jobId: bookingJob.id,
      leaseToken: bookingJob.leaseToken,
      attemptId: snapshot.attemptId,
      expectedRevision: snapshot.expectedRevision,
      rulesVersion: snapshot.rulesVersion,
      connectionId: snapshot.connectionId,
      ...beforeCredentialRace.guards,
    }), 'FEASIBILITY_STALE');
  assert(
    Number(inserts) === 0,
    'Credential changes after fresh validation must block dispatch before insertion.',
  );
  await execute(bookingJob, worker);
  snapshot = await database.command<BookingAttempt>('booking_load', worker, {
    jobId: bookingJob.id,
    leaseToken: bookingJob.leaseToken,
    requestId,
  });
  assert(
    snapshot.phase === 'uncertain' && inserts === 1,
    'Lost successful response must persist uncertainty without a replacement insert.',
  );
  await execute(bookingJob, worker); // Immediate 404 under the same current lease.
  snapshot = await database.command<BookingAttempt>('booking_load', worker, {
    jobId: bookingJob.id,
    leaseToken: bookingJob.leaseToken,
    requestId,
  });
  assert(
    snapshot.phase === 'uncertain' && inserts === 1,
    'Immediate 404 must preserve uncertainty and identity.',
  );
  await complete(bookingJob);
  await expectFailure(() => execute(bookingJob, worker), 'LEASE_LOST');
  await database.command('booking_reconcile', operator, { requestId });
  const reconciliationJobs = await claim();
  const recoveryJob = reconciliationJobs.find((job) =>
    job.kind === 'booking_reconcile' && job.payload.requestId === requestId
  );
  assert(recoveryJob, 'Audited reconciliation must publish an immediately claimable saved job.');
  await expectFailure(
    () => execute(recoveryJob, { kind: 'worker', id: 'wrong-worker' }),
    'LEASE_LOST',
  );
  await execute(recoveryJob, worker);
  await execute(recoveryJob, worker); // Duplicate delivery while lease is still current.
  await complete(recoveryJob);
  const receipt = await database.command<RequestView>('request_read', guest, { requestId });
  assert(
    calendarReads.has(calendarId) && calendarReads.has(conflictCalendarId) && requesterReads >= 2,
    'Actual revalidation must read the booking destination in addition to conflict calendars and re-read requester availability.',
  );
  assert(
    receipt.status === 'booked' && receipt.event?.id === frozenEventId && inserts === 1 &&
      lookups === 2 && providerEvents.size === 1,
    'Reconciliation must confirm exactly one original provider event and no second insert.',
  );

  // Real independent delivery records receive injected failure; no transport is invoked.
  const deliveryJobs = (await claim()).filter((job) => job.kind === 'delivery');
  const recipientEmails = new Set<string>();
  for (const job of deliveryJobs) {
    const fence = { jobId: job.id, leaseToken: job.leaseToken, outboxId: job.payload.outboxId };
    const delivery = await database.command<
      { status: string; recipientEmail: string; payload: Record<string, unknown> }
    >('delivery_load', worker, fence);
    if (delivery.payload.requestId !== requestId) continue;
    assert(
      !JSON.stringify(delivery.payload).includes('PRIVATE-FIXTURE'),
      'Confirmation payload must exclude host private context.',
    );
    recipientEmails.add(delivery.recipientEmail);
    await database.command('delivery_record', worker, {
      ...fence,
      outcome: 'failed',
      errorCode: 'INJECTED_TRANSPORT_UNAVAILABLE',
    });
    await complete(job);
  }
  assert(
    recipientEmails.has(host.email!) && recipientEmails.has(`guest-${runId}@example.invalid`) &&
      recipientEmails.size === 2,
    'Booking must save separate host/requester confirmation identities.',
  );
  const afterDeliveryFailure = await database.command<RequestView>('request_read', guest, {
    requestId,
  });
  assert(
    afterDeliveryFailure.status === 'booked' && inserts === 1 && providerEvents.size === 1,
    'Notification failure cannot reverse booking or repeat insertion.',
  );
  // SQL's trusted confirmed receipts must normalize our online links and survive Google read lag.
  const regressionRequest = async (slot: { start: string; end: string }) => {
    const tokenHash = await digest(crypto.randomUUID());
    return await database.command<RequestView>('request_create', { kind: 'public' }, {
      handle,
      tokenHash,
      details: { ...context.details, windows: [slot] },
    });
  };
  const evaluator = createEvaluator(environment, database, undefined, undefined, {
    fetcher: providerFetcher,
  });
  const laterSlot = {
    start: new Date(end.getTime() + 15 * 60_000).toISOString(),
    end: new Date(end.getTime() + 45 * 60_000).toISOString(),
  };
  const laterRequest = await regressionRequest(laterSlot);
  exposeProviderReceipt = true;
  const freshLater = await evaluator.context(laterRequest.id, laterRequest.revision);
  const ownReceipt = freshLater.input.hostEvents.find((event) =>
    event.id === `${calendarId}:${frozenEventId}`
  );
  assert(
    ownReceipt?.mode === 'online' && !ownReceipt.location && !ownReceipt.physicalLocation,
    'Trusted SQL online receipt must normalize a provider event whose HTTPS link looks physical.',
  );
  await evaluator.validate(laterRequest.id, laterRequest.revision, laterSlot);
  const overlapRequest = await regressionRequest(slot);
  exposeProviderReceipt = false;
  const lagged = await evaluator.context(overlapRequest.id, overlapRequest.revision);
  assert(
    lagged.input.hostEvents.some((event) => event.id === `${calendarId}:${frozenEventId}`),
    'Confirmed SQL receipt must remain busy when Google omits the event.',
  );
  let overlapRejected = false;
  try {
    await evaluator.validate(overlapRequest.id, overlapRequest.revision, slot);
  } catch (error) {
    overlapRejected = error instanceof DomainError && error.code === 'not_feasible';
  }
  assert(
    overlapRejected && inserts === 1,
    'Lagged Google reads cannot make a confirmed slot bookable.',
  );
  console.log(JSON.stringify({
    result: 'passed',
    scope: 'local SQL + durable handler; injected providers',
    requestId,
    checks: [
      'service-only setup and request transitions',
      'message idempotency',
      'contact fixture confirmation',
      'actual runtime encrypted grants and both calendar roles',
      'connection metadata race blocks dispatch',
      'guest/unattributed/stale approval rejection',
      'lost-success response and immediate 404',
      'real durable reconciliation and lease fencing',
      'same event identity and duplicate delivery',
      'separate confirmation failure preserves booked',
      'trusted own online receipts remain online in P3 evaluation',
      'confirmed local receipt stays busy during Google read lag',
    ],
    providerInserts: inserts,
    providerLookups: lookups,
    liveGoogleTested: false,
    externalMessagesSent: 0,
  }));
}

await main().catch((error) => {
  console.error(
    error instanceof RpcFailure
      ? error.message
      : error instanceof Error
      ? error.message
      : 'Local integration failed.',
  );
  Deno.exitCode = 1;
});
