#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { journeyFile, readJson, root, scratch } from "./oauth-probe-lib.mjs";

process.umask(0o077);

const container = "supabase_db_fmat-p0-oauth-probe";
const resource = "http://127.0.0.1:8788/mcp";
const nativeClientsFile = path.join(scratch, "oauth-native-clients.json");
const command = process.argv[2] ?? "help";

async function guardLocalTarget() {
  const status = await readJson(path.join(scratch, "status.json"));
  if (status?.API_URL !== "http://127.0.0.1:55321")
    throw new Error("ISOLATED_API_55321_REQUIRED");
  const database = new URL(status.DB_URL);
  if (database.hostname !== "127.0.0.1" || database.port !== "55322")
    throw new Error("ISOLATED_DATABASE_55322_REQUIRED");
  const inspect = spawnSync(
    "docker",
    ["inspect", "--format", "{{.State.Running}}", container],
    { encoding: "utf8" },
  );
  if (inspect.status !== 0 || inspect.stdout.trim() !== "true")
    throw new Error("ISOLATED_DATABASE_CONTAINER_REQUIRED");
}

function psql(sql, variables = {}) {
  const args = [
    "exec",
    "-i",
    container,
    "psql",
    "-XAt",
    "-v",
    "ON_ERROR_STOP=1",
  ];
  for (const [name, value] of Object.entries(variables))
    args.push("-v", `${name}=${value}`);
  args.push("-U", "postgres", "-d", "postgres");
  const result = spawnSync("docker", args, {
    input: sql,
    encoding: "utf8",
    maxBuffer: 1_000_000,
  });
  if (result.status !== 0)
    throw new Error(`PSQL_FAILED_${result.stderr.trim().split("\n").at(-1)}`);
  return result.stdout.trim();
}

let result;
if (command === "install") {
  await guardLocalTarget();
  const sql = await readFile(
    path.join(root, "scripts/p0/oauth-probe-audience-hook.sql"),
    "utf8",
  );
  psql(sql);
  result = { installed: true, target: "isolated-local-55322" };
} else if (command === "allow") {
  await guardLocalTarget();
  const journeyIndex = process.argv.indexOf("--journey");
  const journey = journeyIndex >= 0 ? process.argv[journeyIndex + 1] : null;
  const state = await readJson(journeyFile(journey));
  if (!state?.client?.client_id || state.resource !== resource)
    throw new Error("VALID_FIXED_RESOURCE_JOURNEY_REQUIRED");
  psql(
    `insert into p0_probe.oauth_client_resources(client_id, resource)
     values (:'client_id'::uuid, :'resource')
     on conflict (client_id) do update set resource = excluded.resource;`,
    { client_id: state.client.client_id, resource },
  );
  result = {
    allowed: true,
    journey,
    clientId: state.client.client_id,
    resource,
  };
} else if (command === "allow-fixed-resource") {
  await guardLocalTarget();
  const journeyIndex = process.argv.indexOf("--journey");
  const journey = journeyIndex >= 0 ? process.argv[journeyIndex + 1] : null;
  const state = await readJson(journeyFile(journey));
  if (!state?.client?.client_id) throw new Error("REGISTERED_JOURNEY_REQUIRED");
  psql(
    `insert into p0_probe.oauth_client_resources(client_id, resource)
     values (:'client_id'::uuid, :'resource')
     on conflict (client_id) do update set resource = excluded.resource;`,
    { client_id: state.client.client_id, resource },
  );
  result = {
    allowed: true,
    journey,
    requestedResource: state.resource,
    mappedResource: resource,
  };
} else if (command === "allow-native") {
  await guardLocalTarget();
  const nameIndex = process.argv.indexOf("--name");
  const name = nameIndex >= 0 ? process.argv[nameIndex + 1] : null;
  const registry = await readJson(nativeClientsFile, { clients: [] });
  const client = registry.clients?.find((candidate) => candidate.name === name);
  if (
    !client ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      client.clientId,
    ) ||
    client.resource !== resource ||
    client.status !== "pending"
  )
    throw new Error("VALID_PENDING_NATIVE_CLIENT_REQUIRED");
  const registered = Number(
    psql(
      "select count(*) from auth.oauth_clients where id = :'client_id'::uuid;",
      { client_id: client.clientId },
    ),
  );
  if (registered !== 1) throw new Error("REGISTERED_AUTH_CLIENT_REQUIRED");
  psql(
    `insert into p0_probe.oauth_client_resources(client_id, resource)
     values (:'client_id'::uuid, :'resource')
     on conflict (client_id) do update set resource = excluded.resource;`,
    { client_id: client.clientId, resource },
  );
  result = { allowed: true, name, clientId: client.clientId, resource };
} else if (command === "verify") {
  await guardLocalTarget();
  const output = psql(
    "select count(*) from p0_probe.oauth_client_resources where resource = 'http://127.0.0.1:8788/mcp';",
  );
  result = { installed: true, allowlistedClientCount: Number(output) };
} else {
  console.log(`Usage:
  node scripts/p0/oauth-probe-hook.mjs install
  node scripts/p0/oauth-probe-hook.mjs allow --journey browser|terminal
  node scripts/p0/oauth-probe-hook.mjs allow-fixed-resource --journey browser|terminal
  node scripts/p0/oauth-probe-hook.mjs allow-native --name NAME
  node scripts/p0/oauth-probe-hook.mjs verify

The command refuses targets other than the isolated 55321/55322 probe stack.`);
  process.exit(command === "help" ? 0 : 2);
}

if (result) console.log(JSON.stringify(result, null, 2));
