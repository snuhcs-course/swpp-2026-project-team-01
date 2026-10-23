import { parseArgs } from "node:util";
import { isUsableHandle, normalizeHandle } from "../contracts/handles";
import { GOOGLE_CALENDAR_SCOPES } from "../contracts/google-scopes";
import { secretFingerprint } from "./agentmail-receiver";
import {
  type AdminDependencies,
  type AdminTarget,
  AdminUsageError,
  boundedText,
  environmentName,
  PROJECT_REF,
  type Row,
  runLocal,
  runProject,
  sqlLiteral,
  UUID,
} from "./operator-shared";
import { DIAGNOSTICS_USAGE, runDiagnosticsAdmin } from "./diagnostics-admin";
import { RECOVERY_USAGE, runRecoveryAdmin } from "./recovery-operations";
import { DELETION_USAGE, runDeletionAdmin } from "./data-deletion";

export { type AdminDependencies, AdminUsageError, environmentName, sqlLiteral } from "./operator-shared";

// The administrator CLI, `fmat-admin` (host-admission: operator suspension and
// restoration; design §14). It names exactly one environment, validates every
// input before building SQL, passes values as quoted literals, and changes status
// only through app.operator_set_host_status, which writes the audit row in the
// same statement. It holds no user credential: `--local` uses the local stack's
// DATABASE_URL and `--project` the operator's own Supabase access token.

export const ADMIN_USAGE = `fmat-admin: operate Find Me a Time: hosts, email receivers, diagnostics, recovery and deletion.

Usage:
  npm run admin -- show --host <handle-or-id> --operator <name> (--local | --project <ref>)
  npm run admin -- suspend --host <handle-or-id> --reason <text> --operator <name> (--local | --project <ref>) [--yes]
  npm run admin -- restore --host <handle-or-id> --reason <text> --operator <name> (--local | --project <ref>) [--yes]
  npm run admin -- email-receiver list --operator <name> (--local | --project <ref>)
  npm run admin -- email-receiver register --inbox <inbox-id> --webhook <webhook-id> --operator <name> (--local | --project <ref>) [--yes]
  npm run admin -- email-receiver disable --receiver <id> --operator <name> (--local | --project <ref>) [--yes]
${DIAGNOSTICS_USAGE}
${RECOVERY_USAGE}
${DELETION_USAGE}

  --local            Use DATABASE_URL, which must point at the local stack (127.0.0.1 or localhost).
  --project <ref>    Use the Supabase Management API with your own SUPABASE_ACCESS_TOKEN.
  --yes              Skip the typed confirmation of a change.

email-receiver register records an enabled AgentMail receiver for the inbox with
the fingerprint of AGENTMAIL_WEBHOOK_SECRET from your environment, and disables
the inbox's earlier receiver. Point the AgentMail webhook at
{origin}/agentmail/webhooks/{receiver id}. The secret itself is never printed.

diagnostics prints the redacted snapshot and the hourly rejection counts and
changes nothing. recover job gives an exhausted job more attempts; recover
booking starts the reconciliation of a booking whose write is uncertain. Neither
resends an uncertain message, and each is audited. delete-host and
delete-request erase a host's or a request's data on request; a deleted host
keeps only a suspended, nameless account with its handle history and cannot be
restored.`;

const COMMANDS = ["show", "suspend", "restore"] as const;
type Command = (typeof COMMANDS)[number];

export type AdminRequest = {
  readonly command: Command;
  // A lower-case host account ID or a normalized handle.
  readonly host: string;
  readonly operator: string;
  readonly reason: string | null;
  readonly target: AdminTarget;
  readonly yes: boolean;
};

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
    and coalesce(g.granted_scopes @> array[${GOOGLE_CALENDAR_SCOPES.map(sqlLiteral).join(", ")}]::text[], false)
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

// ---------------------------------------------------------------------------
// AgentMail receivers (requester-email-channel D10)

const RECEIVER_COMMANDS = ["list", "register", "disable"] as const;
type ReceiverCommand = (typeof RECEIVER_COMMANDS)[number];

export type ReceiverRequest = {
  readonly command: ReceiverCommand;
  readonly inbox: string | null;
  readonly webhook: string | null;
  readonly receiver: string | null;
  readonly operator: string;
  readonly target: AdminRequest["target"];
  readonly yes: boolean;
};

const RECEIVER_OPTIONS = {
  inbox: { type: "string" },
  local: { type: "boolean" },
  operator: { type: "string" },
  project: { type: "string" },
  receiver: { type: "string" },
  webhook: { type: "string" },
  yes: { type: "boolean" },
} as const;

// An inbox ID is an address; a webhook ID is an opaque provider identifier.
const INBOX_ID = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/;
const WEBHOOK_ID = /^[A-Za-z0-9_-]{1,200}$/;

export function parseReceiverArguments(argv: readonly string[]): ReceiverRequest {
  let parsed;

  try {
    parsed = parseArgs({ allowPositionals: true, args: [...argv], options: RECEIVER_OPTIONS, strict: true });
  } catch (error) {
    throw new AdminUsageError((error as Error).message);
  }

  const { positionals, values } = parsed;
  const command = positionals[1];

  if (positionals[0] !== "email-receiver" || positionals.length !== 2 || !RECEIVER_COMMANDS.includes(command as ReceiverCommand)) {
    throw new AdminUsageError("Name one email-receiver command: list, register or disable.");
  }

  if (Boolean(values.local) === (values.project !== undefined)) {
    throw new AdminUsageError("Name exactly one environment: --local or --project <ref>.");
  }

  if (values.project !== undefined && !PROJECT_REF.test(values.project)) {
    throw new AdminUsageError("--project must be a Supabase project ref (20 lowercase letters).");
  }

  const inbox = values.inbox?.trim().toLowerCase() ?? null;
  const webhook = values.webhook?.trim() ?? null;
  const receiver = values.receiver?.trim().toLowerCase() ?? null;

  if (command === "register") {
    if (!inbox || inbox.length > 320 || !INBOX_ID.test(inbox)) throw new AdminUsageError("--inbox must be the inbox address.");
    if (!webhook || !WEBHOOK_ID.test(webhook)) throw new AdminUsageError("--webhook must be the AgentMail webhook ID.");
    if (receiver) throw new AdminUsageError("register takes no --receiver.");
  } else if (command === "disable") {
    if (!receiver || !UUID.test(receiver)) throw new AdminUsageError("--receiver must be a receiver ID.");
    if (inbox || webhook) throw new AdminUsageError("disable takes only --receiver.");
  } else if (inbox || webhook || receiver) {
    throw new AdminUsageError("list takes no --inbox, --webhook or --receiver.");
  }

  return {
    command: command as ReceiverCommand,
    inbox,
    operator: boundedText(values.operator, "operator", 100),
    receiver,
    target: values.project === undefined ? { kind: "local" } : { kind: "project", ref: values.project },
    webhook,
    yes: Boolean(values.yes),
  };
}

// The one SQL statement a receiver request runs. register needs the signing
// secret's fingerprint; only the fingerprint reaches the database.
export function receiverSql(request: ReceiverRequest, fingerprint: string | null) {
  switch (request.command) {
    case "list":
      return `select id::text as receiver_id, inbox_id, webhook_id, state, operator, created_at::text, disabled_at::text
from app.email_receivers order by created_at desc limit 20`;
    case "register":
      return `select result_receiver_id::text as receiver_id, result_inbox_id as inbox_id, result_state as state
from app.operator_register_email_receiver(${sqlLiteral(request.inbox!)}, ${sqlLiteral(request.webhook!)}, ${sqlLiteral(fingerprint!)}, ${sqlLiteral(request.operator)}, ${sqlLiteral(environmentName(request.target))})`;
    case "disable":
      return `select result_receiver_id::text as receiver_id, result_inbox_id as inbox_id, result_state as state
from app.operator_disable_email_receiver(${sqlLiteral(request.receiver!)}::uuid, ${sqlLiteral(request.operator)})`;
  }
}

async function runReceiverAdmin(argv: readonly string[], deps: AdminDependencies): Promise<number> {
  let request: ReceiverRequest;

  try {
    request = parseReceiverArguments(argv);
  } catch (error) {
    deps.stderr(`fmat-admin: ${(error as Error).message}`);
    deps.stderr(ADMIN_USAGE);
    return 2;
  }

  const environment = environmentName(request.target);
  let fingerprint: string | null = null;

  if (request.command === "register") {
    const secret = deps.env.AGENTMAIL_WEBHOOK_SECRET?.trim();

    if (!secret?.startsWith("whsec_")) {
      deps.stderr("fmat-admin: register needs the webhook's signing secret (whsec_...) in AGENTMAIL_WEBHOOK_SECRET.");
      return 1;
    }

    fingerprint = secretFingerprint(secret);
  }

  if (request.command !== "list") {
    const subject = request.command === "register" ? request.inbox! : request.receiver!;
    deps.stdout(`Environment: ${environment}`);
    deps.stdout(`Action: email-receiver ${request.command} ${subject}`);

    if (!request.yes) {
      if (!deps.interactive) {
        deps.stderr("fmat-admin: refusing to change a receiver without --yes when no one can confirm interactively.");
        return 1;
      }

      const answer = await deps.prompt(`Type ${subject} to confirm: `);

      if (answer.trim().toLowerCase() !== subject) {
        deps.stderr("fmat-admin: confirmation did not match; nothing changed.");
        return 1;
      }
    }
  }

  const sql = receiverSql(request, fingerprint);
  let rows: Row[];

  try {
    rows = request.target.kind === "local" ? await runLocal(sql, deps.env) : await runProject(sql, request.target.ref, deps);
  } catch (error) {
    const message = (error as Error).message;
    deps.stderr(`fmat-admin: ${/unknown receiver/.test(message) ? `no receiver matches ${request.receiver}.` : message}`);
    return 1;
  }

  if (request.command === "list") deps.stdout(`Environment: ${environment}`);
  if (rows.length === 0) deps.stdout("No receivers.");

  for (const row of rows) {
    deps.stdout(
      [row.receiver_id, row.inbox_id, row.state, row.webhook_id, row.created_at]
        .filter((value) => value !== undefined && value !== null)
        .map(String)
        .join("  "),
    );
  }

  return 0;
}

// Runs one CLI invocation and returns its exit code: 0 done, 1 refused or failed,
// 2 usage error.
export async function runAdmin(argv: readonly string[], deps: AdminDependencies): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    deps.stdout(ADMIN_USAGE);
    return argv.length === 0 ? 2 : 0;
  }

  if (argv[0] === "email-receiver") return runReceiverAdmin(argv, deps);
  if (argv[0] === "diagnostics") return runDiagnosticsAdmin(argv, deps, ADMIN_USAGE);
  if (argv[0] === "recover") return runRecoveryAdmin(argv, deps, ADMIN_USAGE);
  if (argv[0] === "delete-host" || argv[0] === "delete-request") return runDeletionAdmin(argv, deps, ADMIN_USAGE);

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
    deps.stderr(
      `fmat-admin: ${/unknown host/.test(message) ? `no host matches ${request.host}.` : /deleted host/.test(message) ? "that host's data was deleted on request; it cannot be changed." : message}`,
    );
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
