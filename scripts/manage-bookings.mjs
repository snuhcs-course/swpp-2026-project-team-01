import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const usage = `Operator-only booking reconciliation and guarded retry.

Disposable local database:
  node scripts/manage-bookings.mjs reconcile --local --operator-id local-test --request-id UUID
  node scripts/manage-bookings.mjs retry --local --operator-id local-test --request-id UUID

Linked remote project (load server-only credentials from the ignored .env):
  node --env-file=.env scripts/manage-bookings.mjs reconcile --project-ref REF --operator-id OPERATOR --request-id UUID
  node --env-file=.env scripts/manage-bookings.mjs retry --project-ref REF --operator-id OPERATOR --request-id UUID

Reconciliation queues observation of the saved Calendar event identity.
Retry is subject to database proof of noncreation and current approval prerequisites.
No manual status override or blind retry of an uncertain write is supported.
Remote calls require matching SUPABASE_PROJECT_REF, SUPABASE_URL, and CLI link cache.
SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY must be a server-only privileged key.`;

const isUuid = (value) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value ?? '');

function privilegedKey(key) {
  if (key?.startsWith('sb_secret_') && key.length >= 30) return key;
  try {
    const segments = key?.split('.');
    if (segments?.length === 3 && JSON.parse(Buffer.from(segments[1], 'base64url')).role === 'service_role') return key;
  } catch { /* Real credentials are verified by the API; malformed keys fail before a call. */ }
  throw new Error('A server-only secret/service_role key is required; publishable, anon, and user keys are rejected');
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      local: { type: 'boolean' },
      help: { type: 'boolean' },
      'project-ref': { type: 'string' },
      'operator-id': { type: 'string' },
      'request-id': { type: 'string' },
    },
  });
  if (values.help) return console.log(usage);
  const [operation] = positionals;
  if (positionals.length !== 1 || !['reconcile', 'retry'].includes(operation)) throw new Error('Specify reconcile or retry; use --help for usage');
  const operator = values['operator-id'];
  if (!operator || operator !== operator.trim() || operator.length > 200 || /[\x00-\x1f\x7f]/.test(operator)) {
    throw new Error('An explicit --operator-id is required for the audit record');
  }
  const requestId = values['request-id'];
  if (!isUuid(requestId)) throw new Error('An explicit --request-id UUID is required');
  if (Boolean(values.local) === Boolean(values['project-ref'])) throw new Error('Select exactly one target: --local or --project-ref REF');

  let origin;
  let key;
  if (values.local) {
    const result = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Start the disposable local Supabase stack before using --local');
    let status;
    try { status = JSON.parse(result.stdout); } catch { throw new Error('Cannot parse local Supabase status'); }
    origin = status.API_URL;
    if (!['http://127.0.0.1:54321', 'http://localhost:54321'].includes(origin)) throw new Error('Local status must identify the local API on port 54321');
    key = privilegedKey(status.SECRET_KEY || status.SERVICE_ROLE_KEY);
  } else {
    const project = values['project-ref'];
    if (!/^[a-z0-9]{20}$/.test(project) || process.env.SUPABASE_PROJECT_REF !== project) throw new Error('Explicit --project-ref must match SUPABASE_PROJECT_REF');
    let target;
    try { target = new URL(process.env.SUPABASE_URL); } catch { throw new Error('Configure the intended SUPABASE_URL'); }
    if (target.origin !== `https://${project}.supabase.co` || target.href !== `${target.origin}/`) throw new Error('SUPABASE_URL must be the exact HTTPS origin of the explicit project');
    let linked;
    try { linked = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim(); }
    catch { throw new Error('Link the intended Supabase project before remote administration'); }
    if (linked !== project) throw new Error('The CLI linked-project cache does not match the explicit target');
    origin = target.origin;
    key = privilegedKey(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  }

  let response;
  try {
    response = await fetch(`${origin}/rest/v1/rpc/fmat_command`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_operation: operation === 'reconcile' ? 'booking_reconcile' : 'booking_retry',
        p_actor: { kind: 'operator', id: operator },
        p_input: { requestId, idempotencyKey: randomUUID() },
      }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch { throw new Error('RPC outcome is unknown; inspect the operator audit before repeating. No automatic retry was made'); }
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`RPC returned unreadable data (HTTP ${response.status}); inspect the operator audit before repeating`); }
  if (!response.ok) {
    const category = /^[A-Z_]{1,60}$/.test(result?.message ?? '') ? result.message : 'RPC_REJECTED';
    throw new Error(`Booking command failed: ${category} (HTTP ${response.status})`);
  }
  if (result?.ok !== true) throw new Error('RPC did not confirm acceptance; inspect the operator audit before repeating');
  // Report only an allowlisted outcome, never provider evidence or credentials.
  const outcome = { requestId, operation, accepted: true };
  if (result.retired === true) outcome.retired = true;
  if (isUuid(result.attemptId)) outcome.attemptId = result.attemptId;
  if (result.nextAction === 'review_proposal') outcome.nextAction = result.nextAction;
  console.log(JSON.stringify(outcome, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Booking administration failed');
  process.exitCode = 1;
});
