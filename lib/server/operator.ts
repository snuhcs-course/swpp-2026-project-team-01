import { parseArgs } from "node:util";
import { isUsableHandle, normalizeHandle } from "../contracts/handles";
import { GOOGLE_CALENDAR_SCOPES } from "../contracts/google-scopes";
import { createDatabase } from "./database";

// The administrator CLI, `fmat-admin` (host-admission: operator suspension and
// restoration; design §14). It names exactly one environment, validates every
// input before building SQL, passes values as quoted literals, and changes status
// only through app.operator_set_host_status, which writes the audit row in the
// same statement. It holds no user credential: `--local` uses the local stack's
// DATABASE_URL and `--project` the operator's own Supabase access token.

export type AdminDependencies = {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  // Whether a person can answer the typed confirmation.
  readonly interactive: boolean;
  readonly prompt: (question: string) => Promise<string>;
  readonly fetch?: typeof fetch;
  // The Management API origin; tests point it at a fake server.
  readonly managementApiUrl?: string;
};

export const ADMIN_USAGE = `fmat-admin: suspend, restore or inspect a Find Me a Time host.

Usage:
  npm run admin -- show --host <handle-or-id> --operator <name> (--local | --project <ref>)
  npm run admin -- suspend --host <handle-or-id> --reason <text> --operator <name> (--local | --project <ref>) [--yes]
  npm run admin -- restore --host <handle-or-id> --reason <text> --operator <name> (--local | --project <ref>) [--yes]

  --local            Use DATABASE_URL, which must point at the local stack (127.0.0.1 or localhost).
  --project <ref>    Use the Supabase Management API with your own SUPABASE_ACCESS_TOKEN.
  --yes              Skip the typed confirmation of a suspension or restoration.`;

const COMMANDS = ["show", "suspend", "restore"] as const;
type Command = (typeof COMMANDS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_REF = /^[a-z]{20}$/;
// oxlint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const EVENTS_SCOPE = GOOGLE_CALENDAR_SCOPES[1];

export class AdminUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminUsageError";
  }
}

export type AdminRequest = {
  readonly command: Command;
  // A lower-case host account ID or a normalized handle.
  readonly host: string;
  readonly operator: string;
  readonly reason: string | null;
  readonly target: { readonly kind: "local" } | { readonly kind: "project"; readonly ref: string };
  readonly yes: boolean;
};

function boundedText(value: string | undefined, name: string, max: number) {
  const text = value?.trim() ?? "";

  if (!text) throw new AdminUsageError(`--${name} is required.`);
  if (text.length > max) throw new AdminUsageError(`--${name} must be at most ${max} characters.`);
  if (CONTROL.test(text)) throw new AdminUsageError(`--${name} must not contain control characters.`);

  return text;
}

const OPTIONS = {
  host: { type: "string" },
  local: { type: "boolean" },
  operator: { type: "string" },
  project: { type: "string" },
  reason: { type: "string" },
  yes: { type: "boolean" },
} as const;

function parseOptions(argv: readonly string[]) {
  try {
    return parseArgs({ allowPositionals: true, args: [...argv], options: OPTIONS, strict: true });
  } catch (error) {
    throw new AdminUsageError((error as Error).message);
  }
}

// Parses and validates argv; nothing here builds SQL.
export function parseAdminArguments(argv: readonly string[]): AdminRequest {
  const parsed = parseOptions(argv);
  const { positionals, values } = parsed;
  const command = positionals[0];

  if (positionals.length !== 1 || !COMMANDS.includes(command as Command)) {
    throw new AdminUsageError("Name one command: show, suspend or restore.");
  }

  const rawHost = values.host?.trim() ?? "";
  const host = UUID.test(rawHost) ? rawHost.toLowerCase() : normalizeHandle(rawHost);

  if (!UUID.test(host) && !isUsableHandle(host)) {
    throw new AdminUsageError("--host must be a host account ID or a valid handle.");
  }

  if (Boolean(values.local) === (values.project !== undefined)) {
    throw new AdminUsageError("Name exactly one environment: --local or --project <ref>.");
  }

  if (values.project !== undefined && !PROJECT_REF.test(values.project)) {
    throw new AdminUsageError("--project must be a Supabase project ref (20 lowercase letters).");
  }

  const mutation = command !== "show";

  if (!mutation && values.reason !== undefined) {
    throw new AdminUsageError("show takes no --reason.");
  }

  return {
    command: command as Command,
    host,
    operator: boundedText(values.operator, "operator", 100),
    reason: mutation ? boundedText(values.reason, "reason", 500) : null,
    target: values.project === undefined ? { kind: "local" } : { kind: "project", ref: values.project },
    yes: Boolean(values.yes),
  };
}

// A SQL string literal: the value in single quotes with each quote doubled. The
// inputs were validated first and contain no control characters.
export function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function environmentName(target: AdminRequest["target"]) {
  return target.kind === "local" ? "local" : `project:${target.ref}`;
}

// The one SQL statement a request runs. show reads status, current handle and
// readiness with the same shape as readReadiness in lib/server/readiness.ts.
export function adminSql(request: AdminRequest) {
  const host = sqlLiteral(request.host);

  if (request.command === "show") {
    const match = UUID.test(request.host)
      ? `a.id = ${host}::uuid`
      : `a.id = (select host_account_id from app.host_handles where handle = ${host} and released_at is null)`;

    return `select
  a.id::text as host_account_id,
  a.status,
  h.handle,
  (
    a.status = 'active'
    and s.host_account_id is not null
    and s.settings -> 'bookingCalendar' ->> 'id' is not null
    and s.settings -> 'bookingCalendar' ->> 'unwritableAt' is null
    and h.handle is not null
    and g.refresh_token_ciphertext is not null
    and g.invalidated_at is null
    and ${sqlLiteral(EVENTS_SCOPE)} = any (g.granted_scopes)
  ) as ready
from app.host_accounts a
left join app.host_settings s on s.host_account_id = a.id
left join app.host_handles h on h.host_account_id = a.id and h.released_at is null
left join app.provider_grants g on g.host_account_id = a.id
where ${match}`;
  }

  const status = request.command === "suspend" ? "suspended" : "active";

  return `select result_host_account_id::text as host_account_id, result_status as status, result_previous_status as previous_status
from app.operator_set_host_status(${host}, ${sqlLiteral(status)}, ${sqlLiteral(request.operator)}, ${sqlLiteral(request.reason ?? "")}, ${sqlLiteral(environmentName(request.target))})`;
}

type Row = Record<string, unknown>;

async function runLocal(sql: string, env: AdminDependencies["env"]): Promise<Row[]> {
  const url = env.DATABASE_URL;

  if (!url) throw new AdminUsageError("--local needs DATABASE_URL.");

  let hostname: string;

  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new AdminUsageError("DATABASE_URL is not a valid URL.");
  }

  if (!LOCAL_HOSTS.has(hostname)) {
    throw new AdminUsageError("--local refuses a DATABASE_URL that is not the local stack (127.0.0.1 or localhost).");
  }

  const db = createDatabase(url);

  try {
    return [...(await db.unsafe<Row[]>(sql))];
  } finally {
    await db.end();
  }
}

async function runProject(sql: string, ref: string, deps: AdminDependencies): Promise<Row[]> {
  const token = deps.env.SUPABASE_ACCESS_TOKEN;

  if (!token) throw new AdminUsageError("--project needs your own SUPABASE_ACCESS_TOKEN.");

  const base = deps.managementApiUrl ?? "https://api.supabase.com";
  const response = await (deps.fetch ?? fetch)(`${base}/v1/projects/${ref}/database/query`, {
    body: JSON.stringify({ query: sql }),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();

  if (!response.ok) {
    let message = text;

    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      // The raw body is the message.
    }

    throw new Error(`The Management API answered ${response.status}: ${message.slice(0, 500)}`);
  }

  return JSON.parse(text) as Row[];
}

// Runs one CLI invocation and returns its exit code: 0 done, 1 refused or failed,
// 2 usage error.
export async function runAdmin(argv: readonly string[], deps: AdminDependencies): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    deps.stdout(ADMIN_USAGE);
    return argv.length === 0 ? 2 : 0;
  }

  let request: AdminRequest;

  try {
    request = parseAdminArguments(argv);
  } catch (error) {
    deps.stderr(`fmat-admin: ${(error as Error).message}`);
    deps.stderr(ADMIN_USAGE);
    return 2;
  }

  const environment = environmentName(request.target);

  if (request.command !== "show") {
    deps.stdout(`Environment: ${environment}`);
    deps.stdout(`Host: ${request.host}`);
    deps.stdout(`Action: ${request.command}`);

    if (!request.yes) {
      if (!deps.interactive) {
        deps.stderr("fmat-admin: refusing to change status without --yes when no one can confirm interactively.");
        return 1;
      }

      const answer = await deps.prompt(`Type the host (${request.host}) to confirm: `);

      if (answer.trim() !== request.host) {
        deps.stderr("fmat-admin: confirmation did not match; nothing changed.");
        return 1;
      }
    }
  }

  const sql = adminSql(request);
  let rows: Row[];

  try {
    rows =
      request.target.kind === "local" ? await runLocal(sql, deps.env) : await runProject(sql, request.target.ref, deps);
  } catch (error) {
    const message = (error as Error).message;
    deps.stderr(`fmat-admin: ${/unknown host/.test(message) ? `no host matches ${request.host}.` : message}`);
    return 1;
  }

  const [row] = rows;

  if (!row) {
    deps.stderr(`fmat-admin: no host matches ${request.host}.`);
    return 1;
  }

  if (request.command === "show") {
    deps.stdout(`Environment: ${environment}`);
    deps.stdout(`Host account: ${String(row.host_account_id)}`);
    deps.stdout(`Status: ${String(row.status)}`);
    deps.stdout(`Handle: ${row.handle ? String(row.handle) : "none"}`);
    deps.stdout(`Ready: ${row.ready === true ? "yes" : "no"}`);
  } else {
    deps.stdout(`Host account ${String(row.host_account_id)}: ${String(row.previous_status)} -> ${String(row.status)}`);
  }

  return 0;
}
