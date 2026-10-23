import { parseArgs } from "node:util";
import {
  type AdminDependencies,
  type AdminTarget,
  AdminUsageError,
  boundedInteger,
  boundedText,
  confirmChange,
  ENVIRONMENT_OPTIONS,
  environmentName,
  identifier,
  onlyOptions,
  parseTarget,
  refusalMessage,
  runIn,
  sqlLiteral,
} from "./operator-shared";

// fmat-admin's recovery commands (operational-recovery; operations-and-release
// design 6, D7). Recovery only restarts work the system already finishes
// safely: an exhausted job gets more attempts under a new fence, and a booking
// whose write is uncertain gets one reconciliation job, which reads the event by
// its fixed ID before any insert. Nothing here resends an uncertain message,
// releases a reservation or decides a booking's outcome. Each change runs
// through one app.operator_* function that writes its audit row in the same
// statement.

export const RECOVERY_USAGE = `  npm run admin -- recover job --job <id> --reason <text> --operator <name> (--local | --project <ref>) [--attempts <1-10>] [--yes]
  npm run admin -- recover booking --booking <id> --reason <text> --operator <name> (--local | --project <ref>) [--yes]`;

export type RecoveryRequest = {
  readonly command: "job" | "booking";
  // The job or booking ID.
  readonly subject: string;
  readonly attempts: number;
  readonly reason: string;
  readonly operator: string;
  readonly target: AdminTarget;
  readonly yes: boolean;
};

const OPTIONS = {
  attempts: { type: "string" },
  booking: { type: "string" },
  job: { type: "string" },
  local: { type: "boolean" },
  operator: { type: "string" },
  project: { type: "string" },
  reason: { type: "string" },
  yes: { type: "boolean" },
} as const;

export function parseRecoveryArguments(argv: readonly string[]): RecoveryRequest {
  let parsed;

  try {
    parsed = parseArgs({ allowPositionals: true, args: [...argv], options: OPTIONS, strict: true });
  } catch (error) {
    throw new AdminUsageError((error as Error).message);
  }

  const { positionals, values } = parsed;
  const command = positionals[1];

  if (positionals[0] !== "recover" || positionals.length !== 2 || (command !== "job" && command !== "booking")) {
    throw new AdminUsageError("Name one recover command: job or booking.");
  }

  const target = parseTarget(values);
  onlyOptions(values, command === "job" ? [...ENVIRONMENT_OPTIONS, "job", "attempts", "reason", "yes"] : [...ENVIRONMENT_OPTIONS, "booking", "reason", "yes"]);

  return {
    attempts: boundedInteger(values.attempts, "attempts", 1, 10, 3),
    command,
    operator: boundedText(values.operator, "operator", 100),
    reason: boundedText(values.reason, "reason", 500),
    subject: identifier(command === "job" ? values.job : values.booking, command),
    target,
    yes: Boolean(values.yes),
  };
}

// The worker that claims a reconciliation job: the production worker for a
// hosted project, `npm run jobs:dev` for the local stack.
function producerFor(target: AdminTarget) {
  return target.kind === "local" ? "local" : "production";
}

export function recoverySql(request: RecoveryRequest) {
  const audit = `${sqlLiteral(request.operator)}, ${sqlLiteral(request.reason)}, ${sqlLiteral(environmentName(request.target))}`;

  return request.command === "job"
    ? `select result_job_id::text as job_id, result_kind as kind, result_previous_state as previous_state, result_max_attempts as max_attempts
from app.operator_requeue_job(${sqlLiteral(request.subject)}::uuid, ${request.attempts}, ${audit})`
    : `select result_booking_id::text as booking_id, result_job_id::text as job_id, result_previous_state as previous_state
from app.operator_reconcile_booking(${sqlLiteral(request.subject)}::uuid, ${sqlLiteral(producerFor(request.target))}, ${audit})`;
}

const REFUSALS = [
  [/unknown job/, "no job matches that ID."],
  [/job not exhausted/, "the job is not exhausted; only an exhausted job can be requeued."],
  [/job attempt limit reached/, "the job has used its 100 attempts."],
  [/unknown booking/, "no booking matches that ID."],
  [/booking not dispatching/, "the booking is not waiting on an uncertain write."],
  [/reconciliation already running/, "a booking job for it is already pending or running."],
] as const;

// Runs one recover invocation: 0 done, 1 refused or failed, 2 usage error.
export async function runRecoveryAdmin(argv: readonly string[], deps: AdminDependencies, usage: string): Promise<number> {
  let request: RecoveryRequest;

  try {
    request = parseRecoveryArguments(argv);
  } catch (error) {
    deps.stderr(`fmat-admin: ${(error as Error).message}`);
    deps.stderr(usage);
    return 2;
  }

  const confirmed = await confirmChange(deps, {
    action: request.command === "job" ? "requeue job" : "reconcile booking",
    environment: environmentName(request.target),
    subject: request.subject,
    yes: request.yes,
  });

  if (!confirmed) return 1;

  let row;

  try {
    [row] = await runIn(request.target, recoverySql(request), deps);
  } catch (error) {
    deps.stderr(`fmat-admin: ${refusalMessage(error, REFUSALS)}`);
    return 1;
  }

  if (!row) {
    deps.stderr("fmat-admin: the database returned no result.");
    return 1;
  }

  deps.stdout(
    request.command === "job"
      ? `Job ${String(row.job_id)} (${String(row.kind)}): ${String(row.previous_state)} -> pending, up to ${String(row.max_attempts)} attempts`
      : `Booking ${String(row.booking_id)}: ${String(row.previous_state)}; reconciliation job ${String(row.job_id)} published`,
  );

  return 0;
}
