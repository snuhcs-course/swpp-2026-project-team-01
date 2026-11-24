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
  sqlLiteral,
} from "./operator-shared";

// fmat-admin's diagnostics commands (operational-diagnostics; operations-and-
// release design 4 and 5; channel-usage-report design 3): the redacted
// snapshot, the hourly rejection counts and the daily or weekly channel usage
// counts. Each names exactly one environment, only reads, and prints the
// database's own JSON either as JSON or as readable lines.

export const DIAGNOSTICS_USAGE = `  npm run admin -- diagnostics snapshot --operator <name> (--local | --project <ref>) [--samples <1-20>] [--json]
  npm run admin -- diagnostics rejections --operator <name> (--local | --project <ref>) [--json]
  npm run admin -- diagnostics usage --operator <name> (--local | --project <ref>) [--by day|week] [--periods <n>] [--until <YYYY-MM-DD>] [--json]`;

const SUBCOMMANDS = ["snapshot", "rejections", "usage"] as const;

// The usage report's periods: the default count and the most one call may name.
const USAGE_PERIODS = { day: { fallback: 14, max: 90 }, week: { fallback: 8, max: 52 } } as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DiagnosticsRequest = {
  readonly command: (typeof SUBCOMMANDS)[number];
  readonly json: boolean;
  readonly samples: number;
  readonly usage?: { readonly by: "day" | "week"; readonly periods: number; readonly until: string | null };
  readonly operator: string;
  readonly target: AdminTarget;
};

const OPTIONS = {
  by: { type: "string" },
  json: { type: "boolean" },
  local: { type: "boolean" },
  operator: { type: "string" },
  periods: { type: "string" },
  project: { type: "string" },
  samples: { type: "string" },
  until: { type: "string" },
} as const;

const COMMAND_OPTIONS: Record<DiagnosticsRequest["command"], readonly string[]> = {
  rejections: [...ENVIRONMENT_OPTIONS, "json"],
  snapshot: [...ENVIRONMENT_OPTIONS, "samples", "json"],
  usage: [...ENVIRONMENT_OPTIONS, "by", "periods", "until", "json"],
};

// A real calendar date in YYYY-MM-DD, or null when absent.
function untilDate(value: string | undefined) {
  if (value === undefined) return null;
  const parsed = DATE.test(value) ? new Date(`${value}T00:00:00Z`) : null;

  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AdminUsageError("--until must be a date in YYYY-MM-DD.");
  }

  return value;
}

function usageOptions(values: { by?: string; periods?: string; until?: string }) {
  const by = values.by ?? "day";

  if (by !== "day" && by !== "week") throw new AdminUsageError("--by must be day or week.");

  const { fallback, max } = USAGE_PERIODS[by];
  return { by, periods: boundedInteger(values.periods, "periods", 1, max, fallback), until: untilDate(values.until) } as const;
}

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
    throw new AdminUsageError("Name one diagnostics command: snapshot, rejections or usage.");
  }

  const target = parseTarget(values);
  onlyOptions(values, COMMAND_OPTIONS[command]);

  return {
    command,
    json: Boolean(values.json),
    operator: boundedText(values.operator, "operator", 100),
    samples: boundedInteger(values.samples, "samples", 1, 20, 20),
    target,
    ...(command === "usage" ? { usage: usageOptions(values) } : {}),
  };
}

export function diagnosticsSql(request: DiagnosticsRequest) {
  if (request.command === "snapshot") return `select app.operator_diagnostics_snapshot(${request.samples}) as snapshot`;
  if (request.command === "rejections") return "select app.operator_rejection_snapshot() as snapshot";

  const { by, periods, until } = request.usage!;
  return `select app.operator_channel_usage_report('${by}', ${periods}, ${until ? sqlLiteral(until) : "null"}::date) as snapshot`;
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

type UsagePeriod = {
  readonly start: string;
  readonly recordedDays: number;
  readonly activeHosts: number;
  readonly inboundMessages: number;
  readonly guestLinks: number;
  readonly guestBookings: number;
};

type UsageReport = {
  readonly observedAt: string;
  readonly period: "day" | "week";
  readonly from: string;
  readonly to: string;
  readonly recordedFrom: string | null;
  readonly lastRecordedAt: string | null;
  readonly channels: readonly { name: string; periods: readonly UsagePeriod[] }[];
  readonly notes: readonly string[];
};

// One line per channel and period: counts only, and how much of the period was
// recorded when not all of it.
function printUsage(report: UsageReport, out: (line: string) => void) {
  const length = report.period === "day" ? 1 : 7;
  out(`Observed at: ${report.observedAt} (${report.period === "day" ? "UTC days" : "ISO weeks"} ${report.from} to ${report.to})`);
  out(report.recordedFrom ? `Recorded from ${report.recordedFrom}, last counted at ${report.lastRecordedAt}` : "Nothing has been recorded yet.");

  for (const channel of report.channels) {
    out(`${channel.name}:`);

    for (const period of channel.periods) {
      const coverage =
        period.recordedDays === 0 ? "  (not recorded)" : period.recordedDays < length ? `  (${period.recordedDays} of ${length} days recorded)` : "";
      out(
        `  ${period.start}  active hosts ${period.activeHosts}  inbound ${period.inboundMessages}  guest links ${period.guestLinks}  guest bookings ${period.guestBookings}${coverage}`,
      );
    }
  }

  for (const note of report.notes) out(`Note: ${note}`);
}

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

  const snapshot = (typeof value === "string" ? JSON.parse(value) : value) as Snapshot & RejectionSnapshot & UsageReport;

  if (request.json) {
    deps.stdout(JSON.stringify({ environment, ...snapshot }));
  } else {
    deps.stdout(`Environment: ${environment}`);
    if (request.command === "snapshot") printSnapshot(snapshot, deps.stdout);
    else if (request.command === "rejections") printRejections(snapshot, deps.stdout);
    else printUsage(snapshot, deps.stdout);
  }

  return 0;
}
