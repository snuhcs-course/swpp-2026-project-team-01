// AI-generated with Codex, 2026-10-05 (Asia/Seoul).
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const project = process.env.SUPABASE_PROJECT_REF;
const origin = process.env.SUPABASE_URL;
const secret = process.env.WORKER_SECRET;
if (!project || !origin || new URL(origin).hostname !== `${project}.supabase.co` || !secret || secret.length < 32) {
  throw new Error('Identify the Supabase project and persisted worker secret');
}
if (readFileSync('supabase/.temp/project-ref', 'utf8').trim() !== project) {
  throw new Error('The linked project does not match the deployment target');
}
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const sql = `
do $runtime$
declare secret_id uuid;
begin
  select id into secret_id from vault.secrets where name='fmat_worker_secret';
  if secret_id is null then
    perform vault.create_secret(${quote(secret)}, 'fmat_worker_secret');
  else
    perform vault.update_secret(secret_id, ${quote(secret)});
  end if;
  select id into secret_id from vault.secrets where name='fmat_worker_url';
  if secret_id is null then
    perform vault.create_secret(${quote(`${origin}/functions/v1/worker`)}, 'fmat_worker_url');
  else
    perform vault.update_secret(secret_id, ${quote(`${origin}/functions/v1/worker`)});
  end if;
end;
$runtime$;
select cron.schedule('fmat-worker', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='fmat_worker_url'),
    headers := jsonb_build_object('Content-Type','application/json','X-Worker-Secret',
      (select decrypted_secret from vault.decrypted_secrets where name='fmat_worker_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$job$);
`;
const directory = mkdtempSync(join(tmpdir(), 'fmat-worker-'));
try {
  const path = join(directory, 'runtime.sql');
  writeFileSync(path, sql, { mode: 0o600 });
  const result = spawnSync('supabase', ['db', 'query', '--linked', '--file', path], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Worker scheduling failed');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
