import { parseArgs } from "node:util";
import {
  type AdminDependencies,
  type AdminTarget,
  AdminUsageError,
  boundedInteger,
  boundedText,
  ENVIRONMENT_OPTIONS,
  environmentName,
  onlyOptions,
  parseTarget,
  runIn,
} from "./operator-shared";

// fmat-admin's diagnostics commands (operational-diagnostics; operations-and-
// release design 4 and 5): the redacted snapshot and the hourly rejection
// counts. Both name exactly one environment, only read, and print the
// database's own JSON either as JSON or as readable lines.

export const DIAGNOSTICS_USAGE = `  npm run admin -- diagnostics snapshot --operator <name> (--local | --project <ref>) [--samples <1-20>] [--json]
  npm run admin -- diagnostics rejections --operator <name> (--local | --project <ref>) [--json]`;

const SUBCOMMANDS = ["snapshot", "rejections"] as const;

export type DiagnosticsRequest = {
  readonly command: "snapshot" | "rejections";
  readonly json: boolean;
  readonly samples: number;
  readonly operator: string;
  readonly target: AdminTarget;
};

const OPTIONS = {
  json: { type: "boolean" },
  local: { type: "boolean" },
  operator: { type: "string" },
  project: { type: "string" },
  samples: { type: "string" },
} as const;

export function parseDiagnosticsArguments(argv: readonly string[]): DiagnosticsRequest {
  let parsed;

  try {
    parsed = parseArgs({ allowPositionals: true, args: [...argv], options: OPTIONS, strict: true });
  } catch (error) {
    throw new AdminUsageError((error as Error).message);
  }

  const { positionals, values } = parsed;
  const command = positionals[1] as DiagnosticsRequest["command"];

  if (positionals[0] !== "diagnostics" || positionals.length !== 2 || !SUBCOMMANDS.includes(command)) {
    throw new AdminUsageError("Name one diagnostics command: snapshot or rejections.");
  }

  const target = parseTarget(values);
  onlyOptions(values, command === "snapshot" ? [...ENVIRONMENT_OPTIONS, "samples", "json"] : [...ENVIRONMENT_OPTIONS, "json"]);

  return {
    command,
    json: Boolean(values.json),
    operator: boundedText(values.operator, "operator", 100),
    samples: boundedInteger(values.samples, "samples", 1, 20, 20),
    target,
  };
}

export function diagnosticsSql(request: DiagnosticsRequest) {
  return request.command === "snapshot"
    ? `select app.operator_diagnostics_snapshot(${request.samples}) as snapshot`
    : "select app.operator_rejection_snapshot() as snapshot";
}

type Snapshot = {
  readonly observedAt: string;
  readonly categories: readonly { name: string; count: number; oldestAt: string | null; sample: readonly string[] }[];
  readonly notMeasured: readonly string[];
};

type RejectionSnapshot = {
  readonly observedAt: string;
  readonly windowStart: string;
  readonly scope: string;
  readonly notCovered: readonly string[];
  readonly categories: readonly { name: string; total: number; saturated: boolean; buckets: readonly { hour: string; count: number }[] }[];
};

function printSnapshot(snapshot: Snapshot, out: (line: string) => void) {
  out(`Observed at: ${snapshot.observedAt}`);

  for (const category of snapshot.categories) {
    out(`${category.name}: ${category.count}${category.oldestAt ? `  oldest ${category.oldestAt}` : ""}`);
    if (category.sample.length > 0) out(`  ${category.sample.join(" ")}`);
  }

  if (snapshot.categories.every((category) => category.count === 0)) {
    out("No matching records. This is not proof that providers or deliveries work.");
  }

  out(`Not measured here: ${snapshot.notMeasured.join("; ")}`);
}

function printRejections(snapshot: RejectionSnapshot, out: (line: string) => void) {
  out(`Observed at: ${snapshot.observedAt} (window from ${snapshot.windowStart}; the current hour is partial)`);
  out(`Scope: ${snapshot.scope}`);

  for (const category of snapshot.categories) {
    const hours = category.buckets.filter((bucket) => bucket.count > 0).map((bucket) => `${bucket.hour.slice(11, 16)}=${bucket.count}`);
    const saturated = category.saturated ? " (saturated: at least this many)" : "";
    out(`${category.name}: ${category.total}${saturated}${hours.length > 0 ? `  ${hours.join(" ")}` : ""}`);
  }

  out(`Not covered: ${snapshot.notCovered.join("; ")}`);
}

// Runs one diagnostics invocation: 0 done, 1 failed, 2 usage error.
export async function runDiagnosticsAdmin(argv: readonly string[], deps: AdminDependencies, usage: string): Promise<number> {
  let request: DiagnosticsRequest;

  try {
    request = parseDiagnosticsArguments(argv);
  } catch (error) {
    deps.stderr(`fmat-admin: ${(error as Error).message}`);
    deps.stderr(usage);
    return 2;
  }

  const environment = environmentName(request.target);
  let value: unknown;

  try {
    [{ snapshot: value } = { snapshot: undefined }] = await runIn(request.target, diagnosticsSql(request), deps);
  } catch (error) {
    deps.stderr(`fmat-admin: ${(error as Error).message}`);
    return 1;
  }

  if (value === undefined || value === null) {
    deps.stderr("fmat-admin: the database returned no snapshot.");
    return 1;
  }

  const snapshot = (typeof value === "string" ? JSON.parse(value) : value) as Snapshot & RejectionSnapshot;

  if (request.json) {
    deps.stdout(JSON.stringify({ environment, ...snapshot }));
  } else {
    deps.stdout(`Environment: ${environment}`);
    if (request.command === "snapshot") printSnapshot(snapshot, deps.stdout);
    else printRejections(snapshot, deps.stdout);
  }

  return 0;
}
