import { parseArgs } from "node:util";
import { isUsableHandle, normalizeHandle } from "../contracts/handles";
import {
  type AdminDependencies,
  type AdminTarget,
  AdminUsageError,
  boundedText,
  confirmChange,
  environmentName,
  identifier,
  parseTarget,
  refusalMessage,
  runIn,
  sqlLiteral,
  UUID,
} from "./operator-shared";

// fmat-admin's deletion on request (data-stewardship: deletion on request;
// operations-and-release design 9, D10). The operator runs it after verifying
// that the request came from the account's own address. delete-host removes a
// host's data and Auth user and keeps only a suspended, nameless account row
// with its handle history; delete-request removes one request with everything
// under it. Each runs through one app.operator_* function that writes its audit
// row, without the deleted content, in the same statement. A guest account
// has no handle, so delete-host also takes the account's Google address, the
// address the deletion request came from (guest-account-history D3).

export const DELETION_USAGE = `  npm run admin -- delete-host --host <handle-id-or-google-address> --reason <text> --operator <name> (--local | --project <ref>) [--yes]
  npm run admin -- delete-request --request <id> --reason <text> --operator <name> (--local | --project <ref>) [--yes]`;

export type DeletionRequest = {
  readonly command: "delete-host" | "delete-request";
  // A host account ID, normalized handle or lower-cased Google address, or a
  // request ID.
  readonly subject: string;
  readonly reason: string;
  readonly operator: string;
  readonly target: AdminTarget;
  readonly yes: boolean;
};

const OPTIONS = {
  host: { type: "string" },
  local: { type: "boolean" },
  operator: { type: "string" },
  project: { type: "string" },
  reason: { type: "string" },
  request: { type: "string" },
  yes: { type: "boolean" },
} as const;

// One address, as Google reports it on sign-in; quoting in deletionSql keeps
// anything else harmless, and this keeps a typo from reaching the database.
const GOOGLE_ADDRESS = /^[^\s@'"]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,63}$/;

export function parseDeletionArguments(argv: readonly string[]): DeletionRequest {
  let parsed;

  try {
    parsed = parseArgs({ allowPositionals: true, args: [...argv], options: OPTIONS, strict: true });
  } catch (error) {
    throw new AdminUsageError((error as Error).message);
  }

  const { positionals, values } = parsed;
  const command = positionals[0];

  if (positionals.length !== 1 || (command !== "delete-host" && command !== "delete-request")) {
    throw new AdminUsageError("Name one command: delete-host or delete-request.");
  }

  const target = parseTarget(values);
  let subject: string;

  if (command === "delete-host") {
    if (values.request !== undefined) throw new AdminUsageError("delete-host takes no --request.");
    const raw = values.host?.trim() ?? "";
    if (raw.includes("@")) {
      subject = raw.toLowerCase();
      if (!GOOGLE_ADDRESS.test(subject)) throw new AdminUsageError("--host must be a host account ID, a valid handle or a Google address.");
    } else {
      subject = UUID.test(raw) ? raw.toLowerCase() : normalizeHandle(raw);
      if (!UUID.test(subject) && !isUsableHandle(subject)) throw new AdminUsageError("--host must be a host account ID, a valid handle or a Google address.");
    }
  } else {
    if (values.host !== undefined) throw new AdminUsageError("delete-request takes no --host.");
    subject = identifier(values.request, "request");
  }

  return {
    command,
    operator: boundedText(values.operator, "operator", 100),
    reason: boundedText(values.reason, "reason", 500),
    subject,
    target,
    yes: Boolean(values.yes),
  };
}

export function deletionSql(request: DeletionRequest) {
  const audit = `${sqlLiteral(request.operator)}, ${sqlLiteral(request.reason)}, ${sqlLiteral(environmentName(request.target))}`;

  // An address resolves to its account's ID; one that matches no account
  // leaves the address itself, which operator_delete_host refuses as unknown.
  const target = request.subject.includes("@")
    ? `coalesce((select g.host_account_id::text from app.google_identities g where lower(g.email) = ${sqlLiteral(request.subject)}), ${sqlLiteral(request.subject)})`
    : sqlLiteral(request.subject);

  return request.command === "delete-host"
    ? `select result_host_account_id::text as id, result_previous_status as previous_state
from app.operator_delete_host(${target}, ${audit})`
    : `select result_request_id::text as id, result_previous_state as previous_state
from app.operator_delete_request(${sqlLiteral(request.subject)}::uuid, ${audit})`;
}

const REFUSALS = [
  [/unknown host/, "no account matches that handle, ID or address."],
  [/host already deleted/, "that host's data was already deleted."],
  [/unknown request/, "no request matches that ID."],
  [/booking in flight/, "a booking write may exist; reconcile it with recover booking first."],
] as const;

// Runs one deletion: 0 done, 1 refused or failed, 2 usage error.
export async function runDeletionAdmin(argv: readonly string[], deps: AdminDependencies, usage: string): Promise<number> {
  let request: DeletionRequest;

  try {
    request = parseDeletionArguments(argv);
  } catch (error) {
    deps.stderr(`fmat-admin: ${(error as Error).message}`);
    deps.stderr(usage);
    return 2;
  }

  const confirmed = await confirmChange(deps, {
    action: request.command,
    environment: environmentName(request.target),
    subject: request.subject,
    yes: request.yes,
  });

  if (!confirmed) return 1;

  let row;

  try {
    [row] = await runIn(request.target, deletionSql(request), deps);
  } catch (error) {
    deps.stderr(`fmat-admin: ${refusalMessage(error, REFUSALS)}`);
    return 1;
  }

  if (!row) {
    deps.stderr("fmat-admin: the database returned no result.");
    return 1;
  }

  deps.stdout(
    request.command === "delete-host"
      ? `Host account ${String(row.id)} (${String(row.previous_state)}): data deleted; the account stays suspended with its handle history`
      : `Request ${String(row.id)} (${String(row.previous_state)}): deleted`,
  );

  return 0;
}
