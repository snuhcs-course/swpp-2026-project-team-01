// `npm run restore:drill [-- --keep]`: the backup restoration drill
// (data-stewardship: backup restoration drill; operations-and-release design 7,
// D8). It runs inside the local stack's database container and touches no
// database a service uses:
//   1. builds fmat_drill_source from the local database's schema and migration
//      history, then fills it with the synthetic fixture
//      supabase/tests/fixtures/restore-drill.sql;
//   2. takes a logical backup of it with pg_dump --format=custom;
//   3. restores the backup with pg_restore into the empty fmat_drill_restored;
//   4. compares every table's row count and ordered row hash, the migration
//      history and constraint validity, and runs the diagnostics snapshot on the
//      restored copy;
//   5. checks that the local database itself did not change, and drops both
//      drill databases unless --keep is given.
// It prints counts and hashes only, and exits 1 when anything differs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCHEMAS = ["app", "auth", "supabase_migrations"];
export const SOURCE = "fmat_drill_source";
export const RESTORED = "fmat_drill_restored";
const DUMP = "/tmp/fmat-restore-drill.dump";

const root = fileURLToPath(new URL("..", import.meta.url));

export function containerName(config: string) {
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!projectId) throw new Error("supabase/config.toml has no project_id.");
  return `supabase_db_${projectId}`;
}

function exec(container: string, args: readonly string[], input?: string) {
  return execFileSync("docker", ["exec", "-i", container, ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// Runs SQL as the local superuser in one database and returns the unaligned rows.
function sql(container: string, database: string, statement: string) {
  return exec(container, ["psql", "-U", "supabase_admin", "-d", database, "-v", "ON_ERROR_STOP=1", "-AtX", "-c", statement]).trim();
}

const schemaList = SCHEMAS.map((schema) => `'${schema}'`).join(", ");

// Row count and an MD5 of every row in a fixed order, per table.
export function tableFingerprints(container: string, database: string) {
  const tables = sql(
    container,
    database,
    `select format('%I.%I', schemaname, tablename) from pg_tables where schemaname in (${schemaList}) order by 1`,
  )
    .split("\n")
    .filter(Boolean);
  const fingerprints = new Map<string, string>();

  for (const table of tables) {
    fingerprints.set(
      table,
      sql(container, database, `select count(*) || ':' || coalesce(md5(string_agg(t::text, '|' order by t::text)), '-') from ${table} t`),
    );
  }

  return fingerprints;
}

export function compareFingerprints(source: Map<string, string>, restored: Map<string, string>) {
  const differences: string[] = [];

  for (const [table, fingerprint] of source) {
    if (restored.get(table) !== fingerprint) differences.push(table);
  }

  for (const table of restored.keys()) {
    if (!source.has(table)) differences.push(table);
  }

  return differences;
}

function dropDrillDatabases(container: string) {
  for (const database of [SOURCE, RESTORED]) {
    sql(container, "postgres", `drop database if exists ${database} with (force)`);
  }
}

export function runDrill(options: { readonly keep: boolean; readonly log: (line: string) => void }) {
  const container = containerName(readFileSync(`${root}supabase/config.toml`, "utf8"));
  const fixture = readFileSync(`${root}supabase/tests/fixtures/restore-drill.sql`, "utf8");
  const schemaFlags = SCHEMAS.flatMap((schema) => ["-n", schema]);
  const before = tableFingerprints(container, "postgres");

  dropDrillDatabases(container);

  try {
    // 1. The source: the local schema and migration history, then synthetic data.
    sql(container, "postgres", `create database ${SOURCE}`);
    const schema = exec(container, ["pg_dump", "-U", "supabase_admin", "-d", "postgres", "--schema-only", ...schemaFlags]);
    exec(container, ["psql", "-U", "supabase_admin", "-d", SOURCE, "-v", "ON_ERROR_STOP=1", "-qX"], schema);
    const history = exec(container, ["pg_dump", "-U", "supabase_admin", "-d", "postgres", "--data-only", "-t", "supabase_migrations.schema_migrations"]);
    exec(container, ["psql", "-U", "supabase_admin", "-d", SOURCE, "-v", "ON_ERROR_STOP=1", "-qX"], history);
    exec(container, ["psql", "-U", "supabase_admin", "-d", SOURCE, "-v", "ON_ERROR_STOP=1", "-qX"], fixture);

    // 2. The backup.
    exec(container, ["pg_dump", "-U", "supabase_admin", "-d", SOURCE, "--format=custom", ...schemaFlags, "-f", DUMP]);

    // 3. The restore, into a database no service is configured to reach.
    sql(container, "postgres", `create database ${RESTORED}`);
    exec(container, ["pg_restore", "-U", "supabase_admin", "-d", RESTORED, "--exit-on-error", DUMP]);

    // 4. The comparison.
    const source = tableFingerprints(container, SOURCE);
    const restored = tableFingerprints(container, RESTORED);
    const differences = compareFingerprints(source, restored);
    const rows = [...source.values()].reduce((total, fingerprint) => total + Number(fingerprint.split(":")[0]), 0);
    const migrations = (database: string) => sql(container, database, "select count(*) || ':' || max(version) from supabase_migrations.schema_migrations");
    const notValid = sql(container, RESTORED, `select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname in (${schemaList}) and not c.convalidated`);
    const snapshot = sql(container, RESTORED, "select jsonb_array_length(app.operator_diagnostics_snapshot(5) -> 'categories')");

    options.log(`Tables compared: ${source.size}; rows in the source: ${rows}`);
    options.log(`Migration history: source ${migrations(SOURCE)}, restored ${migrations(RESTORED)}`);
    options.log(`Constraints not valid after restore: ${notValid}`);
    options.log(`Diagnostics snapshot on the restored copy: ${snapshot} categories`);

    // 5. Isolation: the local database is unchanged.
    const after = tableFingerprints(container, "postgres");
    const touched = compareFingerprints(before, after);

    const failures = [
      ...differences.map((table) => `restored ${table} differs from the source`),
      ...(migrations(SOURCE) === migrations(RESTORED) ? [] : ["the migration history differs"]),
      ...(notValid === "0" ? [] : [`${notValid} constraints are not valid`]),
      ...(snapshot === "10" ? [] : ["the diagnostics snapshot did not run"]),
      ...(rows > 0 ? [] : ["the source holds no rows"]),
      ...touched.map((table) => `the local database's ${table} changed during the drill`),
    ];

    for (const failure of failures) options.log(`FAILED: ${failure}`);
    options.log(failures.length === 0 ? "Restore drill passed." : "Restore drill failed.");
    return failures.length === 0;
  } finally {
    exec(container, ["rm", "-f", DUMP]);
    if (options.keep) options.log(`Kept ${SOURCE} and ${RESTORED}.`);
    else dropDrillDatabases(container);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const keep = process.argv.includes("--keep");
  process.exitCode = runDrill({ keep, log: (line) => console.log(line) }) ? 0 : 1;
}
