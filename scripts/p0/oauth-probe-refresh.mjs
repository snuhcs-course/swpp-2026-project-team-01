#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readJson, scratch, writePrivateJson } from "./oauth-probe-lib.mjs";
import { proveCodexRefresh } from "./oauth-probe-native-guards.mjs";

process.umask(0o077);

const command = process.argv[2] ?? "help";
const runFile = path.join(scratch, "oauth-native-codex-run.json");
const registryFile = path.join(scratch, "oauth-native-clients.json");
const fixtureFile = path.join(scratch, "fixture-credentials.json");
const dbContainer = "supabase_db_fmat-p0-oauth-probe";

function requiredOption(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value || value.startsWith("--"))
    throw new Error(`MISSING_${name.slice(2).toUpperCase().replaceAll("-", "_")}`);
  return value;
}

function privatePath(value) {
  const resolved = path.resolve(value);
  if (!resolved.startsWith(`${scratch}${path.sep}`))
    throw new Error("EVIDENCE_FILE_MUST_BE_IN_PRIVATE_SCRATCH");
  return resolved;
}

async function context() {
  const run = await readJson(runFile);
  const registry = await readJson(registryFile, { clients: [] });
  const fixture = await readJson(fixtureFile);
  const client = registry.clients?.find(
    (candidate) => candidate.name === run?.name,
  );
  if (!/^fmat_p0_native_[0-9a-f]{10}$/.test(run?.name ?? ""))
    throw new Error("PERSISTED_TASK_UNIQUE_NATIVE_NAME_REQUIRED");
  if (
    client?.status !== "active" ||
    !/^[0-9a-f-]{36}$/i.test(client.clientId ?? "")
  )
    throw new Error("ACTIVE_NATIVE_CLIENT_REQUIRED");
  if (
    fixture?.email !== "p0-oauth-fixture@findmeatime.invalid" ||
    !/^[0-9a-f-]{36}$/i.test(fixture.userId ?? "")
  )
    throw new Error("EXACT_FIXTURE_REQUIRED");
  return { run, client, fixture };
}

function authSnapshot(clientId, fixtureUserId) {
  const sql = `
    with target_sessions as (
      select id, oauth_client_id, user_id,
             to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' as created_at_utc,
             case when refreshed_at is null then null else
               to_char((refreshed_at at time zone 'UTC') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z'
             end as refreshed_at_utc,
             refresh_token_counter, scopes
      from auth.sessions
      where oauth_client_id = '${clientId}'::uuid
        and user_id = '${fixtureUserId}'::uuid
    ), target_refresh_tokens as (
      select token,
             parent,
             revoked,
             nullif(parent, '') is not null as has_parent,
             created_at,
             updated_at
      from auth.refresh_tokens
      where session_id = (select id from target_sessions)
    ), linked_rotation as (
      select parent.created_at as parent_created_at,
             parent.updated_at as parent_revoked_at,
             child.created_at as child_created_at
      from target_refresh_tokens child
      join target_refresh_tokens parent on child.parent = parent.token
      where not child.revoked and parent.revoked
    ), refresh_audit as (
      select count(*)::int as event_count
      from auth.audit_log_entries
      where payload::jsonb->>'action' = 'token_refreshed'
        and payload::jsonb->>'actor_id' = '${fixtureUserId}'
    ), latest_refresh_audit as (
      select id,
             payload::jsonb->>'actor_id' as actor_id,
             payload::jsonb->>'action' as action,
             payload::jsonb->>'log_type' as log_type,
             to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' as created_at_utc
      from auth.audit_log_entries
      where payload::jsonb->>'action' = 'token_refreshed'
        and payload::jsonb->>'actor_id' = '${fixtureUserId}'
      order by created_at desc
      limit 1
    )
    select json_build_object(
      'sessions', coalesce((select json_agg(json_build_object(
        'id', id,
        'oauthClientId', oauth_client_id,
        'userId', user_id,
        'createdAt', created_at_utc,
        'refreshedAt', refreshed_at_utc,
        'refreshTokenCounter', refresh_token_counter,
        'scopes', scopes
      ) order by created_at_utc) from target_sessions), '[]'::json),
      'refreshTokenState', (select json_build_object(
        'rowCount', count(*)::int,
        'activeCount', count(*) filter (where not revoked)::int,
        'revokedCount', count(*) filter (where revoked)::int,
        'parentLinkedCount', count(*) filter (where has_parent)::int,
        'linkedRotationCount', (select count(*)::int from linked_rotation),
        'linkedParentCreatedAt', (select to_char(parent_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' from linked_rotation),
        'linkedParentRevokedAt', (select to_char(parent_revoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' from linked_rotation),
        'linkedChildCreatedAt', (select to_char(child_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' from linked_rotation)
      ) from target_refresh_tokens),
      'tokenRefreshedAuditCount', (select event_count from refresh_audit),
      'latestTokenRefreshedEvent', (select json_build_object(
        'id', id,
        'actorId', actor_id,
        'action', action,
        'logType', log_type,
        'createdAt', created_at_utc
      ) from latest_refresh_audit)
    );`;
  const result = spawnSync(
    "docker",
    [
      "exec",
      dbContainer,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atc",
      sql,
    ],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 100_000 },
  );
  if (result.status !== 0) throw new Error("ISOLATED_AUTH_DB_SNAPSHOT_FAILED");
  const parsed = JSON.parse(result.stdout.trim());
  if (parsed.sessions?.length !== 1)
    throw new Error("EXACTLY_ONE_NATIVE_OAUTH_SESSION_REQUIRED");
  return {
    authSession: parsed.sessions[0],
    refreshTokenState: parsed.refreshTokenState,
    tokenRefreshedAuditCount: parsed.tokenRefreshedAuditCount,
    latestTokenRefreshedEvent: parsed.latestTokenRefreshedEvent,
  };
}

async function snapshot(label) {
  if (!/^(before|after)$/.test(label))
    throw new Error("SNAPSHOT_LABEL_MUST_BE_BEFORE_OR_AFTER");
  const { run, client, fixture } = await context();
  const auth = authSnapshot(client.clientId, fixture.userId);
  const capturedAt = new Date().toISOString();
  const evidence = {
    evidenceSchemaVersion: 2,
    timestampNormalization: "database-utc-rfc3339",
    label,
    capturedAt,
    serverName: run.name,
    clientId: client.clientId,
    fixtureUserId: fixture.userId,
    ...auth,
  };
  const file = path.join(
    scratch,
    `native-refresh-${run.name}-${label}-${capturedAt.replaceAll(/[:.]/g, "-")}.json`,
  );
  await writePrivateJson(file, evidence);
  return { label, evidenceFile: path.relative(process.cwd(), file) };
}

async function readObservations(serverName) {
  const file = path.join(
    scratch,
    `native-token-observations-${serverName}.jsonl`,
  );
  const text = await readFile(file, "utf8");
  const observations = text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { file, observations };
}

async function prove() {
  const beforeFile = privatePath(requiredOption("--before"));
  const afterFile = privatePath(requiredOption("--after"));
  const before = await readJson(beforeFile);
  const after = await readJson(afterFile);
  const { file, observations } = await readObservations(before.serverName);
  const proof = proveCodexRefresh({ before, after, observations });
  return {
    ...proof,
    observationFile: path.relative(process.cwd(), file),
    beforeFile: path.relative(process.cwd(), beforeFile),
    afterFile: path.relative(process.cwd(), afterFile),
  };
}

try {
  let result;
  if (command === "snapshot") result = await snapshot(process.argv[3] ?? "");
  else if (command === "prove") result = await prove();
  else {
    console.log(`Usage:
  node scripts/p0/oauth-probe-refresh.mjs snapshot before|after
  node scripts/p0/oauth-probe-refresh.mjs prove --before FILE --after FILE`);
    process.exit(command === "help" ? 0 : 2);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}
