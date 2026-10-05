import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createCloudflareEmailSender } from '../supabase/functions/_shared/providers/email.ts';

const invitationIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const productionSender = 'no-reply@findmeatime.com';
const codeAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateInvitationCode(bytes = randomBytes(10)) {
  if (bytes.length !== 10) throw new Error('Invitation code requires ten random bytes');
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let characters = '';
  for (let shift = 75n; shift >= 0n; shift -= 5n) {
    characters += codeAlphabet[Number((value >> shift) & 31n)];
  }
  return characters.match(/.{4}/g).join('-');
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || code === 127;
  });
}

const usage = `Operator-only host invitation administration.

Local controlled database (never sends email):
  node scripts/manage-invitations.mjs issue --local --operator-id local-test --email host@example.test
  node scripts/manage-invitations.mjs revoke --local --operator-id local-test --invitation-id UUID

Linked remote project (loads server-only credentials from the ignored .env):
  node --env-file=.env scripts/manage-invitations.mjs issue --project-ref REF --operator-id OPERATOR --email EMAIL
  node --env-file=.env scripts/manage-invitations.mjs revoke --project-ref REF --operator-id OPERATOR --invitation-id UUID

Remote issue sends once through Cloudflare by default. Use --no-email for explicit manual delivery.
Issue output retains the one-time invitation code and setup URL for private operator recovery.
--app-origin defaults to http://localhost:5173 locally and APP_ORIGIN remotely.
Remote calls require matching SUPABASE_PROJECT_REF, SUPABASE_URL, and CLI link cache.
SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY must be a server-only privileged key.`;

function privilegedKey(key) {
  if (key?.startsWith('sb_secret_') && key.length >= 30) return key;
  try {
    const segments = key?.split('.');
    if (segments?.length === 3 && JSON.parse(Buffer.from(segments[1], 'base64url')).role === 'service_role') return key;
  } catch { /* The API verifies real credentials; malformed keys fail before a call. */ }
  throw new Error('A server-only secret/service_role key is required; publishable, anon, and user keys are rejected');
}

function cloudflareIdentity(env) {
  if (
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? '') ||
    !env.CLOUDFLARE_EMAIL_API_TOKEN ||
    env.CLOUDFLARE_EMAIL_FROM !== productionSender
  ) {
    throw new Error(`Remote invitation email requires a Cloudflare account, Email Sending token, and ${productionSender} sender`);
  }
  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_EMAIL_API_TOKEN,
    from: env.CLOUDFLARE_EMAIL_FROM,
  };
}

function prepareInvitationEmail(email, code, expiresAt, setupUrl) {
  return {
    to: [email],
    subject: 'Your Find Me a Time host invitation',
    text: [
      'You have been invited to host meetings with Find Me a Time.',
      '',
      `Setup URL: ${setupUrl}`,
      `Invitation code: ${code}`,
      `Expires: ${expiresAt} (valid for up to seven days)`,
      '',
      `Sign in with this same email address (${email}) and enter the invitation code during setup.`,
      'The code is intentionally separate from the setup URL.',
    ].join('\n'),
  };
}

function createReceipt(receiptPath, receipt) {
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
    flush: true,
  });
  chmodSync(receiptPath, 0o600);
}

function updateReceipt(receiptPath, receipt) {
  const temporaryPath = new URL(`${receiptPath.href}.tmp-${randomUUID()}`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, receiptPath);
  } catch (error) {
    try { unlinkSync(temporaryPath); } catch { /* The temporary file may not exist. */ }
    throw error;
  }
}

export async function manageInvitation({
  argv = process.argv.slice(2),
  env = process.env,
  fetcher = fetch,
  spawn = spawnSync,
  linkedProject,
  receiptDirectory = new URL('../.local/invitations/', import.meta.url),
  now = () => Date.now(),
  makeCode = generateInvitationCode,
  makeIdempotencyKey = randomUUID,
} = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      local: { type: 'boolean' },
      help: { type: 'boolean' },
      'no-email': { type: 'boolean' },
      'project-ref': { type: 'string' },
      'operator-id': { type: 'string' },
      'invitation-id': { type: 'string' },
      email: { type: 'string' },
      'app-origin': { type: 'string' },
    },
  });
  if (values.help) return { help: usage };
  const [operation] = positionals;
  if (positionals.length !== 1 || !['issue', 'revoke'].includes(operation)) throw new Error('Specify issue or revoke; use --help for usage');
  const operator = values['operator-id'];
  if (!operator || operator !== operator.trim() || operator.length > 200 || containsControlCharacter(operator)) {
    throw new Error('An explicit --operator-id is required for the audit record');
  }
  if (Boolean(values.local) === Boolean(values['project-ref'])) throw new Error('Select exactly one target: --local or --project-ref REF');
  const email = values.email?.trim().toLowerCase();
  const invitationId = values['invitation-id'];
  if (operation === 'issue' && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || invitationId)) {
    throw new Error('Issue requires a valid --email and does not accept --invitation-id');
  }
  if (operation === 'revoke' && (!invitationIdPattern.test(invitationId ?? '') || values.email)) {
    throw new Error('Revoke requires --invitation-id UUID and does not accept --email');
  }
  if (values.local && values['no-email']) throw new Error('--no-email is only valid for remote issue');
  if (operation === 'revoke' && values['no-email']) throw new Error('Revocation never sends email and does not accept --no-email');

  const shouldEmail = operation === 'issue' && !values.local && !values['no-email'];
  const cloudflare = shouldEmail ? cloudflareIdentity(env) : undefined;
  let origin;
  let key;
  if (values.local) {
    const result = spawn('supabase', ['status', '-o', 'json'], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Start the disposable local Supabase stack before using --local');
    let status;
    try { status = JSON.parse(result.stdout); } catch { throw new Error('Cannot parse local Supabase status'); }
    origin = status.API_URL;
    if (!['http://127.0.0.1:54321', 'http://localhost:54321'].includes(origin)) throw new Error('Local status must identify the local API on port 54321');
    key = privilegedKey(status.SECRET_KEY || status.SERVICE_ROLE_KEY);
  } else {
    const project = values['project-ref'];
    if (!/^[a-z0-9]{20}$/.test(project) || env.SUPABASE_PROJECT_REF !== project) throw new Error('Explicit --project-ref must match SUPABASE_PROJECT_REF');
    let target;
    try { target = new URL(env.SUPABASE_URL); } catch { throw new Error('Configure the intended SUPABASE_URL'); }
    if (target.origin !== `https://${project}.supabase.co` || target.href !== `${target.origin}/`) {
      throw new Error('SUPABASE_URL must be the exact HTTPS origin of the explicit project');
    }
    let linked = linkedProject;
    if (linked === undefined) {
      try { linked = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim(); }
      catch { throw new Error('Link the intended Supabase project before remote administration'); }
    }
    if (linked !== project) throw new Error('The CLI linked-project cache does not match the explicit target');
    origin = target.origin;
    key = privilegedKey(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
  }
  const app = new URL(values['app-origin'] || (values.local ? 'http://localhost:5173' : env.APP_ORIGIN || 'https://findmeatime.com'));
  if (app.href !== `${app.origin}/` || (!values.local && app.protocol !== 'https:') ||
    (values.local && !['http://localhost:5173', 'http://127.0.0.1:5173'].includes(app.origin))) {
    throw new Error('Use an exact HTTPS app origin remotely or localhost/127.0.0.1:5173 locally');
  }

  const code = operation === 'issue' ? makeCode() : undefined;
  if (operation === 'issue' && (
    typeof code !== 'string' ||
    !/^(?:[0-9A-HJKMNP-TV-Z]{4}-){3}[0-9A-HJKMNP-TV-Z]{4}$/.test(code)
  )) {
    throw new Error('Invitation code generator returned an invalid code');
  }
  const issuedAt = now();
  // One minute below the seven-day maximum tolerates modest operator/server clock skew.
  const input = operation === 'issue'
    ? { email, tokenHash: createHash('sha256').update(code).digest('hex'), expiresAt: new Date(issuedAt + 7 * 86400000 - 60000).toISOString() }
    : { invitationId };
  input.idempotencyKey = makeIdempotencyKey();
  let response;
  try {
    response = await fetcher(`${origin}/rest/v1/rpc/fmat_command`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_operation: operation === 'issue' ? 'invite_issue' : 'invite_revoke', p_actor: { kind: 'operator', id: operator }, p_input: input }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch { throw new Error('RPC outcome is unknown; inspect the operator audit before repeating. No code has been disclosed'); }
  let result;
  try { result = await response.json(); } catch { throw new Error(`RPC returned unreadable data (HTTP ${response.status}); inspect the operator audit before repeating`); }
  if (!response.ok) {
    const category = /^[A-Z_]{1,60}$/.test(result.message ?? '') ? result.message : 'RPC_REJECTED';
    throw new Error(`Invitation command failed: ${category} (HTTP ${response.status})`);
  }
  if (operation === 'revoke') {
    if (result?.ok !== true) throw new Error('RPC did not confirm revocation');
    return { invitationId, revoked: true };
  }
  if (!invitationIdPattern.test(result?.invitationId ?? '') || result.email !== email || result.expiresAt !== input.expiresAt) {
    throw new Error('RPC returned an unexpected invitation record; inspect the operator audit before repeating');
  }

  const setupUrl = `${app.origin}/host/setup`;
  const output = { invitationId: result.invitationId, email, expiresAt: result.expiresAt, code, setupUrl };
  if (!shouldEmail) return { ...output, emailDelivery: { status: 'manual' } };

  const prepared = prepareInvitationEmail(email, code, result.expiresAt, setupUrl);
  const receipt = {
    version: 1,
    invitation: output,
    sender: { provider: 'cloudflare-email-service', accountId: cloudflare.accountId, from: cloudflare.from },
    payload: prepared,
    dispatch: { status: 'dispatching', attemptedAt: new Date(now()).toISOString() },
  };
  const receiptUrl = new URL(`${result.invitationId}.json`, receiptDirectory);
  try {
    mkdirSync(receiptDirectory, { recursive: true, mode: 0o700 });
    chmodSync(receiptDirectory, 0o700);
    createReceipt(receiptUrl, receipt);
  } catch {
    return { ...output, emailDelivery: { status: 'not-sent', code: 'receipt_write_failed' } };
  }

  const sendResult = await createCloudflareEmailSender(cloudflare.accountId, cloudflare.token, cloudflare.from, fetcher)(prepared);
  receipt.dispatch = sendResult.kind === 'sent'
    ? { ...receipt.dispatch, status: 'sent', reference: sendResult.reference }
    : { ...receipt.dispatch, status: sendResult.kind, code: sendResult.code };
  try { updateReceipt(receiptUrl, receipt); } catch { /* Atomic replacement preserves the pre-send receipt. */ }
  return {
    ...output,
    emailDelivery: sendResult.kind === 'sent'
      ? { status: 'sent', reference: sendResult.reference }
      : { status: sendResult.kind, code: sendResult.code },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const result = await manageInvitation({ argv });
  if (result.help) console.log(result.help);
  else {
    console.log(JSON.stringify(result, null, 2));
    if (['rejected', 'uncertain', 'not-sent'].includes(result.emailDelivery?.status)) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Invitation administration failed');
    process.exitCode = 1;
  });
}
