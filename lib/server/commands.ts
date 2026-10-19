import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  COMMAND_ERROR_MESSAGES,
  type CommandErrorCategory,
  type CommandErrorReason,
  type CommandFailure,
} from "../contracts/command-errors";
import type { Database, Queryable, Transaction } from "./database";
import { findHostAccountByAuthUser } from "./host-accounts";
import { type SupabaseAuthConfig, verifiedUserId } from "./supabase-auth";

// The application command pipeline. Every interface (web route, agent tool, CLI)
// runs a mutation through runCommand, which in order:
//   1. rejects actor claims in the untrusted input and derives the actor only from
//      verified credentials;
//   2. reports unavailable configuration before doing any work;
//   3. validates the input against the command's schema;
//   4. in one transaction, checks that the connection is the application owner,
//      takes the retry-key lock, replays or rejects a used retry key, runs the
//      command (which takes its domain locks, rechecks authority and the expected
//      revision, and publishes its jobs) and saves the outcome.
// Lock order: the retry-key advisory lock first, then the command's domain locks.

export type Actor = {
  readonly kind: "host_account";
  readonly id: string;
};

export type CommandContext<Input> = {
  readonly actor: Actor;
  readonly correlationId: string;
  readonly expectedRevision: number | null;
  readonly input: Input;
  readonly resourceId: string;
};

export type CommandDefinition<Input, Result> = {
  readonly operation: string;
  readonly input: z.ZodType<Input>;
  // Environment variables the command's provider needs. When one is missing the
  // command reports unavailable configuration instead of running.
  readonly requires?: readonly string[];
  readonly run: (tx: Transaction, context: CommandContext<Input>) => Promise<Result>;
};

export type CommandRequest = {
  readonly expectedRevision?: number | null;
  readonly input: unknown;
  readonly resourceId: string;
  readonly retryKey: string;
};

export type CommandOutcome<Result> =
  | { readonly ok: true; readonly correlationId: string; readonly replayed: boolean; readonly result: Result }
  | { readonly ok: false; readonly error: CommandFailure };

export type CommandDependencies = {
  // Resolves the actor from verified credentials (a Supabase session, an internal
  // bearer); null when the caller is not authenticated.
  readonly authenticate: () => Promise<Actor | null>;
  readonly db: Database;
  readonly env?: Readonly<Record<string, string | undefined>>;
};

export class CommandError extends Error {
  readonly category: CommandErrorCategory;
  readonly reason: CommandErrorReason | undefined;

  constructor(category: CommandErrorCategory, options?: { cause?: unknown; reason?: CommandErrorReason }) {
    super(COMMAND_ERROR_MESSAGES[category], options);
    this.name = "CommandError";
    this.category = category;
    this.reason = options?.reason;
  }
}

// Keys an untrusted input may not use to name who is acting.
const ACTOR_CLAIMS = ["actor", "actorId", "hostAccountId", "principal", "principalId", "userId"];

function claimsActor(input: unknown) {
  return typeof input === "object" && input !== null && ACTOR_CLAIMS.some((key) => key in input);
}

// JSON with object keys sorted, so equal values always hash alike.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

function actorKey(actor: Actor) {
  return `${actor.kind}:${actor.id}`;
}

export function missingConfiguration(
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return names.filter((name) => !env[name]?.trim());
}

// Reachability of the application is separate from each provider's readiness: a
// provider is ready only when every variable it needs is set.
export function configurationStatus(
  providers: Readonly<Record<string, readonly string[]>>,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return {
    application: "reachable" as const,
    providers: Object.fromEntries(
      Object.entries(providers).map(([name, required]) => [
        name,
        missingConfiguration(required, env).length === 0 ? ("ready" as const) : ("unavailable" as const),
      ]),
    ),
  };
}

export function assertRevision(current: number, expected: number | null) {
  if (expected === null || current !== expected) {
    throw new CommandError("stale_revision");
  }
}

export function commandFailure(error: unknown, correlationId: string, operation: string): CommandFailure {
  const category = error instanceof CommandError ? error.category : "internal";
  const reason = error instanceof CommandError ? error.reason : undefined;

  // Diagnostics name the category and the error class only: messages and causes
  // can carry provider tokens or private text.
  console.error(
    JSON.stringify({
      category,
      correlationId,
      error: error instanceof Error ? error.name : typeof error,
      event: "command_failed",
      operation,
    }),
  );

  return { category, correlationId, message: COMMAND_ERROR_MESSAGES[category], ...(reason ? { reason } : {}) };
}

// Only the owner of the private schema may run commands. A Data API role that
// somehow reached this boundary is refused before any private read.
async function assertCommandRole(tx: Transaction) {
  const [row] = await tx<{ allowed: boolean }[]>`
    select pg_has_role(current_user, n.nspowner, 'MEMBER') as allowed
    from pg_namespace n
    where n.nspname = 'app'
  `;

  if (!row?.allowed) {
    throw new CommandError("forbidden");
  }
}

export async function runCommand<Input, Result>(
  deps: CommandDependencies,
  command: CommandDefinition<Input, Result>,
  request: CommandRequest,
): Promise<CommandOutcome<Result>> {
  const correlationId = randomUUID();

  try {
    if (claimsActor(request.input)) {
      throw new CommandError("forbidden");
    }

    const actor = await deps.authenticate();

    if (!actor) {
      throw new CommandError("unauthenticated");
    }

    if (missingConfiguration(command.requires ?? [], deps.env).length > 0) {
      throw new CommandError("unavailable_configuration");
    }

    const parsed = command.input.safeParse(request.input);
    const retryKey = request.retryKey;

    if (!parsed.success || typeof retryKey !== "string" || retryKey.length < 1 || retryKey.length > 200) {
      throw new CommandError("invalid_input");
    }

    const expectedRevision = request.expectedRevision ?? null;
    const inputHash = createHash("sha256")
      .update(canonicalJson({ expectedRevision, input: parsed.data, resourceId: request.resourceId }))
      .digest("hex");
    const key = actorKey(actor);

    const outcome = (await deps.db.begin(async (tx) => {
      await assertCommandRole(tx);
      await tx`select pg_advisory_xact_lock(hashtextextended(${`app.command:${key}:${retryKey}`}, 0))`;

      const [saved] = await tx<{ input_hash: string; operation: string; resource_id: string; result: Result }[]>`
        select operation, resource_id, input_hash, result
        from app.command_outcomes
        where actor = ${key} and retry_key = ${retryKey}
      `;

      if (saved) {
        if (
          saved.operation !== command.operation ||
          saved.resource_id !== request.resourceId ||
          saved.input_hash !== inputHash
        ) {
          throw new CommandError("retry_conflict");
        }

        return { replayed: true, result: saved.result };
      }

      const result = await command.run(tx, {
        actor,
        correlationId,
        expectedRevision,
        input: parsed.data,
        resourceId: request.resourceId,
      });

      const [stored] = await tx<{ result: Result }[]>`
        insert into app.command_outcomes (actor, retry_key, operation, resource_id, input_hash, result)
        values (${key}, ${retryKey}, ${command.operation}, ${request.resourceId}, ${inputHash},
                ${tx.json((result ?? null) as Parameters<typeof tx.json>[0])})
        returning result
      `;

      return { replayed: false, result: stored!.result };
    })) as { replayed: boolean; result: Result };

    return { correlationId, ok: true, ...outcome };
  } catch (error) {
    return { error: commandFailure(error, correlationId, command.operation), ok: false };
  }
}

// The actor of a browser request: the Supabase user whose access token Auth
// verifies (not just a decoded cookie; never refreshed here), mapped to its host account.
export async function verifiedHostActor(
  request: Request,
  deps: { readonly auth: SupabaseAuthConfig; readonly db: Queryable },
): Promise<Actor | null> {
  const userId = await verifiedUserId(request, deps.auth);

  if (!userId) {
    return null;
  }

  const account = await findHostAccountByAuthUser(deps.db, userId);
  return account ? { id: account.id, kind: "host_account" } : null;
}
