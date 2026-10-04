import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const usage = `Operator-only host invitation administration. No messages are sent.

Local controlled database:
  node scripts/manage-invitations.mjs issue --local --operator-id local-test --email host@example.test
  node scripts/manage-invitations.mjs revoke --local --operator-id local-test --invitation-id UUID

Linked remote project (load server-only credentials from the ignored .env):
  node --env-file=.env scripts/manage-invitations.mjs issue --project-ref REF --operator-id OPERATOR --email EMAIL
  node --env-file=.env scripts/manage-invitations.mjs revoke --project-ref REF --operator-id OPERATOR --invitation-id UUID

Issue prints a one-time token and a setup URL. Keep terminal output private.
--app-origin defaults to http://localhost:5173 locally and APP_ORIGIN remotely.
Remote calls require matching SUPABASE_PROJECT_REF, SUPABASE_URL, and CLI link cache.
SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY must be a server-only privileged key.`;

function privilegedKey(key) {
  if (key?.startsWith('sb_secret_') && key.length >= 30) return key;
  try {
    const segments = key?.split('.');
    if (segments?.length === 3 && JSON.parse(Buffer.from(segments[1], 'base64url')).role === 'service_role') {
      return key;
    }
  } catch { /* The API verifies real credentials; malformed keys fail before a call. */ }
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
      'invitation-id': { type: 'string' },
      email: { type: 'string' },
      'app-origin': { type: 'string' },
    },
  });
  if (values.help) return console.log(usage);
  const [operation] = positionals;
  if (positionals.length !== 1 || !['issue', 'revoke'].includes(operation)) throw new Error('Specify issue or revoke; use --help for usage');
  const operator = values['operator-id'];
  if (!operator || operator !== operator.trim() || operator.length > 200 || /[\x00-\x1f\x7f]/.test(operator)) {
    throw new Error('An explicit --operator-id is required for the audit record');
  }
  if (Boolean(values.local) === Boolean(values['project-ref'])) throw new Error('Select exactly one target: --local or --project-ref REF');
  const email = values.email?.trim().toLowerCase();
  const invitationId = values['invitation-id'];
  if (operation === 'issue' && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || invitationId)) {
    throw new Error('Issue requires a valid --email and does not accept --invitation-id');
  }
  if (operation === 'revoke' && (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(invitationId ?? '') || values.email)) {
    throw new Error('Revoke requires --invitation-id UUID and does not accept --email');
  }

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
    if (!/^[a-z0-9]{20}$/.test(project) || process.env.SUPABASE_PROJECT_REF !== project) {
      throw new Error('Explicit --project-ref must match SUPABASE_PROJECT_REF');
    }
    let target;
    try { target = new URL(process.env.SUPABASE_URL); } catch { throw new Error('Configure the intended SUPABASE_URL'); }
    if (target.origin !== `https://${project}.supabase.co` || target.href !== `${target.origin}/`) {
      throw new Error('SUPABASE_URL must be the exact HTTPS origin of the explicit project');
    }
    let linked;
    try { linked = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim(); }
    catch { throw new Error('Link the intended Supabase project before remote administration'); }
    if (linked !== project) throw new Error('The CLI linked-project cache does not match the explicit target');
    origin = target.origin;
    key = privilegedKey(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  const app = new URL(values['app-origin'] || (values.local ? 'http://localhost:5173' : process.env.APP_ORIGIN || 'https://findmeatime.com'));
  if (app.href !== `${app.origin}/` || (!values.local && app.protocol !== 'https:') ||
    (values.local && !['http://localhost:5173', 'http://127.0.0.1:5173'].includes(app.origin))) {
    throw new Error('Use an exact HTTPS app origin remotely or localhost/127.0.0.1:5173 locally');
  }

  const token = operation === 'issue' ? randomBytes(32).toString('base64url') : undefined;
  // One minute below the seven-day maximum tolerates modest operator/server clock skew.
  const input = operation === 'issue'
    ? { email, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 7 * 86400000 - 60000).toISOString() }
    : { invitationId };
  input.idempotencyKey = randomUUID();
  let response;
  try {
    response = await fetch(`${origin}/rest/v1/rpc/fmat_command`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_operation: operation === 'issue' ? 'invite_issue' : 'invite_revoke', p_actor: { kind: 'operator', id: operator }, p_input: input }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch { throw new Error('RPC outcome is unknown; inspect the operator audit before repeating. No token has been disclosed'); }
  let result;
  try { result = await response.json(); } catch { throw new Error(`RPC returned unreadable data (HTTP ${response.status}); inspect the operator audit before repeating`); }
  if (!response.ok) {
    const category = /^[A-Z_]{1,60}$/.test(result.message ?? '') ? result.message : 'RPC_REJECTED';
    throw new Error(`Invitation command failed: ${category} (HTTP ${response.status})`);
  }
  if (operation === 'issue') {
    if (!result?.invitationId || result.email !== email || result.expiresAt !== input.expiresAt) {
      throw new Error('RPC returned an unexpected invitation record; inspect the operator audit before repeating');
    }
    console.log(JSON.stringify({ invitationId: result.invitationId, email, expiresAt: result.expiresAt, token, setupUrl: `${app.origin}/host/setup` }, null, 2));
  } else {
    if (result?.ok !== true) throw new Error('RPC did not confirm revocation');
    console.log(JSON.stringify({ invitationId, revoked: true }, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Invitation administration failed');
  process.exitCode = 1;
});
