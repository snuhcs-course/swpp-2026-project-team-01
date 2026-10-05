import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const project = process.env.SUPABASE_PROJECT_REF;
if (!project || !process.env.SUPABASE_URL?.includes(project)) {
  throw new Error('Identify the matching Supabase project before deployment');
}
if (process.env.SUPABASE_SECRET_KEY?.startsWith('sb_publishable_')) {
  throw new Error('SUPABASE_SECRET_KEY must be a privileged key, not a publishable key');
}
if (readFileSync('supabase/.temp/project-ref', 'utf8').trim() !== project) {
  throw new Error('Linked Supabase project does not match the identified deployment target');
}
const run = (args) => {
  const result = spawnSync('supabase', args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Supabase ${args[0]} failed`);
};
const secrets = {
  FMAT_SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  APP_ORIGIN: process.env.APP_ORIGIN ?? 'https://findmeatime.com',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? 'gpt-4o-mini-2024-07-18',
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
  WORKER_SECRET: process.env.WORKER_SECRET,
  AGENTMAIL_API_KEY: process.env.AGENTMAIL_API_KEY,
  AGENTMAIL_INBOX_ID: process.env.AGENTMAIL_INBOX_ID,
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_EMAIL_API_TOKEN: process.env.CLOUDFLARE_EMAIL_API_TOKEN,
  CLOUDFLARE_EMAIL_FROM: process.env.CLOUDFLARE_EMAIL_FROM,
  TRANSACTIONAL_EMAIL_ENABLED: process.env.TRANSACTIONAL_EMAIL_ENABLED ?? 'false',
  EXTERNAL_SENDS_ENABLED: process.env.EXTERNAL_SENDS_ENABLED ?? 'false',
};
if (!secrets.TOKEN_ENCRYPTION_KEY || !secrets.WORKER_SECRET) {
  throw new Error(
    'Persist TOKEN_ENCRYPTION_KEY and WORKER_SECRET in the ignored .env before deployment; never rotate them implicitly',
  );
}
if (secrets.TRANSACTIONAL_EMAIL_ENABLED === 'true' || secrets.EXTERNAL_SENDS_ENABLED === 'true') {
  if (
    !/^[a-f0-9]{32}$/.test(secrets.CLOUDFLARE_ACCOUNT_ID ?? '') ||
    !secrets.CLOUDFLARE_EMAIL_API_TOKEN ||
    !/^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(secrets.CLOUDFLARE_EMAIL_FROM ?? '')
  ) {
    throw new Error(
      'Enabled email delivery requires a Cloudflare account, Email Sending token, and verified sender address',
    );
  }
}
const directory = mkdtempSync(join(tmpdir(), 'fmat-deploy-'));
try {
  const path = join(directory, 'secrets.env');
  writeFileSync(
    path,
    Object.entries(secrets).filter(([, value]) => value).map(([name, value]) => `${name}=${value}`)
      .join('\n'),
    { mode: 0o600 },
  );
  run(['db', 'push', '--linked', '--dry-run']);
  run(['db', 'push', '--linked', '--yes']);
  run(['secrets', 'set', '--project-ref', project, '--env-file', path]);
  run([
    'functions',
    'deploy',
    'api',
    'worker',
    '--project-ref',
    project,
    '--use-api',
    '--no-verify-jwt',
  ]);
  const runtime = spawnSync(process.execPath, ['scripts/install-worker-runtime.mjs'], {
    stdio: 'inherit',
    env: process.env,
  });
  if (runtime.status !== 0) throw new Error('Worker runtime installation failed');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
