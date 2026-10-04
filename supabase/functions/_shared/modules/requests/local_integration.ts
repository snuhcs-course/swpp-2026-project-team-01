// Local-only RPC evidence with injected Google/model providers. Never points at a remote project.
import { createDatabase } from '../../database.ts';
import type { Environment } from '../../env.ts';
import { encryptSecret, hashToken, randomToken } from '../../security.ts';
import { DomainError, errorResponse } from '../../errors.ts';
import { HOST_SCOPES } from '../../providers/google.ts';
import { createEvaluator } from './evaluation.ts';
import { requestsRoutes } from '../../../api/routes/requests.ts';
import type {
  MeetingDetails,
  RequestView,
  SetupState,
} from '../../../../../packages/contracts/index.ts';
const status = JSON.parse(await Deno.readTextFile('/tmp/fmat-local-status.json'));
if (status.API_URL !== 'http://127.0.0.1:54321') throw new Error('Disposable local stack required');
const env: Environment = {
  supabaseUrl: status.API_URL,
  serviceKey: status.SECRET_KEY || status.SERVICE_ROLE_KEY,
  appOrigin: 'http://localhost:5173',
  workerSecret: randomToken(),
  encryptionKey: btoa('t'.repeat(32)),
  openaiModel: 'gpt-4o-mini-2024-07-18',
  openaiKey: 'synthetic-injected-only',
  externalSends: false,
};
const db = createDatabase(env);
const host = {
  kind: 'host' as const,
  id: crypto.randomUUID(),
  email: `fixture-${crypto.randomUUID()}@example.invalid`,
};
const worker = { kind: 'worker' as const, id: crypto.randomUUID() };
const handle = `rpc-${host.id.slice(0, 8)}`;
const tokenHash = await hashToken(randomToken());
await db.command('invite_issue', { kind: 'operator', id: 'local-backend-integration' }, {
  email: host.email,
  tokenHash,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  idempotencyKey: randomToken(),
});
await db.command('invite_redeem', host, { tokenHash, idempotencyKey: randomToken() });
const rules = {
  timezone: 'UTC',
  durationMinutes: 30,
  availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '18:00' }],
  focusBlocks: [],
  bufferMinutes: 0,
  travelMode: 'WALK',
  preferences: 'Prefer the latest feasible time',
};
await db.command('setup_save', host, {
  handle,
  displayName: 'Synthetic fixture',
  rules,
  idempotencyKey: randomToken(),
});
const stateHash = await hashToken(randomToken());
const bindingHash = await hashToken(randomToken());
await db.command('oauth_start', host, {
  stateHash,
  bindingHash,
  encryptedVerifier: await encryptSecret({ verifier: randomToken() }, env.encryptionKey!),
  context: { redirectUri: `${env.appOrigin}/api/google/callback` },
  idempotencyKey: randomToken(),
});
const exchange = await db.command<{ exchangeId: string }>('oauth_consume', { kind: 'public' }, {
  stateHash,
  bindingHash,
});
await db.command('credential_save', worker, {
  exchangeId: exchange.exchangeId,
  encryptedCredential: await encryptSecret({
    accessToken: 'synthetic',
    refreshToken: 'synthetic',
    expiresAt: '2099-01-01T00:00:00Z',
    scope: HOST_SCOPES.join(' '),
  }, env.encryptionKey!),
  scopes: HOST_SCOPES,
  providerSubject: host.id,
});
const setup = await db.command<SetupState>('calendar_save', host, {
  conflictCalendarIds: ['synthetic-work'],
  bookingCalendarId: 'synthetic-work',
  verifiedCalendars: [{ id: 'synthetic-work', accessRole: 'owner' }],
  idempotencyKey: randomToken(),
});
if (!setup.profile?.ready) throw new Error('Host fixture not ready');
let staleMutation: (() => Promise<void>) | undefined;
const evaluator = createEvaluator(env, db, undefined, {
  hostEvents: async () => {
    if (staleMutation) {
      const mutation = staleMutation;
      staleMutation = undefined;
      await mutation();
    }
    return [];
  },
  requesterBusy: () => {
    throw new Error('Unexpected requester grant');
  },
}, { rank: (candidates) => Promise.resolve([...candidates].reverse()) });
const app = requestsRoutes(env, db, evaluator);
app.onError((error) => errorResponse(error, 'local-integration'));
const start = new Date(Date.now() + 86400000);
start.setUTCHours(9, 0, 0, 0);
const details: MeetingDetails = {
  requesterName: 'Synthetic requester',
  requesterEmail: 'requester@example.invalid',
  purpose: 'Integration evidence',
  durationMinutes: 30,
  timezone: 'UTC',
  windows: [{ start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString() }],
  mode: 'online',
  location: 'https://host.example.invalid/meeting',
};
async function call(path: string, body?: unknown, token?: string) {
  const response = await app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': randomToken(),
      ...(token ? { 'X-Request-Token': token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error?.code}`);
  return result;
}
const created: { request: RequestView; token: string } = await call(
  `/hosts/${handle}/requests`,
  details,
);
const id = created.request.id;
const token = created.token;
let current: RequestView = await call(`/requests/${id}/evaluate`, {
  expectedRevision: created.request.revision,
}, token);
if (
  current.candidates.length !== 3 ||
  current.candidates[0].start !== new Date(start.getTime() + 1800000).toISOString()
) throw new Error('Feasible ranked candidates mismatch');
const chosen = current.candidates[0];
current = await call(
  `/requests/${id}/proposal`,
  { ...chosen, expectedRevision: current.revision },
  token,
);
if (
  !current.proposal || current.proposal.version !== 1 ||
  Date.parse(current.proposal.start) !== Date.parse(chosen.start) ||
  current.hostApproved || current.contactVerified
) throw new Error('Proposal authority mismatch');
const evidence = await evaluator.validate(id, current.revision, current.proposal);
await db.command('preference_exception_save', host, {
  requestId: id,
  proposalVersion: current.proposal.version,
  expectedRevision: current.revision,
  confirmed: true,
  reason: 'Explicit fixture-only soft preference exception',
  rulesVersion: evidence.rulesVersion,
  idempotencyKey: randomToken(),
});
current = await call(`/requests/${id}`, undefined, token);
const privateView = await db.command<
  { privateSchedulingContext?: { preferenceException?: { reason: string } } }
>('request_read', host, { requestId: id });
if (
  !privateView.privateSchedulingContext?.preferenceException ||
  'privateSchedulingContext' in current || JSON.stringify(current).includes('fixture-only') ||
  current.requesterAgreed || current.hostApproved
) throw new Error('Private exception changed authority or leaked');
if (!current.proposal) throw new Error('Exception removed proposal');
current = await call(`/requests/${id}/agree`, {
  proposalVersion: current.proposal.version,
  expectedRevision: current.revision,
}, token);
if (!current.requesterAgreed || current.hostApproved || current.status !== 'awaiting_approval') {
  throw new Error('Agreement bypassed host decision');
}
if (JSON.stringify(current).includes(rules.preferences) || 'privateDiagnostics' in current) {
  throw new Error('Guest private context leak');
}
staleMutation = async () => {
  await db.command('details_update', {
    kind: 'guest',
    requestId: id,
    tokenHash: await hashToken(token),
  }, {
    requestId: id,
    details: { ...details, purpose: 'Newer revision' },
    expectedRevision: current.revision,
    idempotencyKey: randomToken(),
  });
};
let staleRejected = false;
try {
  await evaluator.evaluate(id, current.revision, randomToken());
} catch (error) {
  staleRejected = error instanceof DomainError && error.code === 'revision_conflict';
}
if (!staleRejected) throw new Error('Stale external result replaced current revision');
const latest: RequestView = await call(`/requests/${id}`, undefined, token);
if (latest.proposal || latest.requesterAgreed || latest.details.purpose !== 'Newer revision') {
  throw new Error('Stale state persisted');
}
const stalePrivate = await db.command<
  { privateSchedulingContext?: { preferenceException?: unknown } }
>('request_read', host, { requestId: id });
if (stalePrivate.privateSchedulingContext?.preferenceException) {
  throw new Error('Stale exception remained current');
}
await call(`/requests/${id}/withdraw`, { expectedRevision: latest.revision }, token);
console.log(
  'PASS: actual local RPC create/evaluate/rank/choose current proposal/private preference exception/agree/guest audience/stale CAS+exception invalidation/withdraw; no external provider calls',
);
