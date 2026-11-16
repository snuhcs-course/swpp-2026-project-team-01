import { z } from "zod";
import { normalizeHandle } from "../contracts/handles";
import type { AccountEmailParameters, AccountEmailTemplate } from "./account-emails";
import { type ChatRouteDependencies, chatDependenciesFromEnvironment, json } from "./chat-routes";
import { CommandError, type CommandDefinition, runCommand } from "./commands";
import type { Transaction } from "./database";
import { deploymentEnvironment } from "./deployment";
import { enqueueEmail } from "./email-delivery";
import { readHostStanding } from "./host-eligibility";
import { type ClaimedJob, type JobHandler, publishJob } from "./jobs";
import { appOriginsFromEnvironment, crossSiteRefusal } from "./same-origin";
import { createRequestAuthClient, verifiedUserId } from "./supabase-auth";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Self-service host account deletion (self-service-account-deletion). A host
// schedules it from Settings by typing their handle; it falls due after a 7-day
// grace period that a Google sign-in cancels; the delayed host_deletion job then
// runs app.operator_delete_host, the operator's own deletion, so the rules stay
// in one place. The host is emailed when it is scheduled, cancelled and run, and
// each open request's guest when it runs.

export const HOST_DELETION_JOB = "host_deletion";
export const DELETION_GRACE_DAYS = 7;
export const SELF_SERVICE_OPERATOR = "self-service";
const SELF_SERVICE_REASON = "requested by the host in Settings";

export type AccountDeletionDependencies = {
  readonly origin: string;
  readonly tokenKey: TokenKey;
};

export function accountDeletionDependenciesFromEnvironment(): AccountDeletionDependencies {
  return { origin: appOriginsFromEnvironment().appOrigin, tokenKey: tokenKeyFromEnvironment() };
}

function appUrl(origin: string) {
  return `${origin.replace(/\/+$/, "")}/app`;
}

// The typed confirmation matches the host's current handle, or their Google
// address when they hold no handle, ignoring case, surrounding spaces and a
// leading @ on the handle.
export function confirmationMatches(typed: string, handle: string | null, email: string | null) {
  const value = typed.trim().toLowerCase();
  if (!value) return false;
  if (handle) return normalizeHandle(value.replace(/^@/, "")) === handle.toLowerCase();
  return email !== null && value === email.trim().toLowerCase();
}

async function hostAddress(tx: Transaction, hostAccountId: string) {
  const [row] = await tx<{ email: string }[]>`
    select email from app.google_identities where host_account_id = ${hostAccountId}
  `;
  return row?.email ?? null;
}

async function enqueueAccountEmail(
  tx: Transaction,
  deps: AccountDeletionDependencies,
  email: {
    readonly kind: AccountEmailTemplate;
    readonly dedupeKey: string;
    readonly recipient: string;
    readonly language: "en" | "ko";
    readonly parameters: AccountEmailParameters;
  },
) {
  await enqueueEmail(tx, { ...email, requestId: null, secrets: {}, tokenKey: deps.tokenKey });
}

// The retry key keeps a schedule made again within the same millisecond after
// a cancellation from sharing the old job. A booking write can postpone the
// deletion (D4), so the job keeps retrying, up to an hour apart, for days.
async function publishDeletionJob(tx: Transaction, hostAccountId: string, due: Date, retryKey: string) {
  const dueAt = due.toISOString();
  await publishJob(tx, {
    dedupeKey: `host:${hostAccountId}:${dueAt}:${retryKey}`,
    kind: HOST_DELETION_JOB,
    maxAttempts: 100,
    payload: { dueAt, hostAccountId },
    runAfter: due,
  });
}

export type ScheduledDeletion = { readonly dueAt: string; readonly alreadyScheduled: boolean };

// host.schedule_deletion: records the due time, publishes the delayed job and
// queues the scheduled email, all in the command's transaction (D2). An account
// already scheduled keeps its due time.
export function scheduleHostDeletionCommand(
  deps: AccountDeletionDependencies,
): CommandDefinition<{ confirmation: string }, ScheduledDeletion> {
  return {
    input: z.object({ confirmation: z.string().min(1).max(320) }).strict(),
    operation: "host.schedule_deletion",
    async run(tx, context) {
      if (context.actor.kind !== "host_account" || context.actor.id !== context.resourceId) throw new CommandError("forbidden");
      const id = context.resourceId;
      const [account] = await tx<{ status: string; deleted_at: Date | null; deletion_due_at: Date | null }[]>`
        select status, deleted_at, deletion_due_at from app.host_accounts where id = ${id} for no key update
      `;
      if (account?.status !== "active" || account.deleted_at) throw new CommandError("forbidden");

      const [handle] = await tx<{ handle: string }[]>`
        select handle from app.host_handles where host_account_id = ${id} and released_at is null
      `;
      const email = await hostAddress(tx, id);
      if (!confirmationMatches(context.input.confirmation, handle?.handle ?? null, email)) {
        throw new CommandError("invalid_input");
      }

      if (account.deletion_due_at) {
        const dueAt = account.deletion_due_at.toISOString();
        // A job that spent its attempts (a booking stuck in dispatching for
        // days) is replaced, so asking again never leaves the schedule dead.
        const [live] = await tx<{ id: string }[]>`
          select id from app.jobs
          where kind = ${HOST_DELETION_JOB} and state in ('pending', 'running')
            and payload ->> 'hostAccountId' = ${id} and payload ->> 'dueAt' = ${dueAt}
        `;
        if (!live) await publishDeletionJob(tx, id, account.deletion_due_at, context.retryKey);
        return { alreadyScheduled: true, dueAt };
      }

      const [scheduled] = await tx<{ deletion_due_at: Date }[]>`
        update app.host_accounts
        set deletion_due_at = date_trunc('milliseconds', now()) + make_interval(days => ${DELETION_GRACE_DAYS}), updated_at = now()
        where id = ${id}
        returning deletion_due_at
      `;
      const dueAt = scheduled!.deletion_due_at.toISOString();

      await publishDeletionJob(tx, id, scheduled!.deletion_due_at, context.retryKey);

      if (email) {
        await enqueueAccountEmail(tx, deps, {
          dedupeKey: `${id}:${dueAt}:${context.retryKey}`,
          kind: "account_deletion_scheduled",
          language: "en",
          parameters: { appUrl: appUrl(deps.origin), dueAt, hostAccountId: id },
          recipient: email,
        });
      }

      return { alreadyScheduled: false, dueAt };
    },
  };
}

// Clears a scheduled deletion in the sign-in transaction and queues the
// cancellation email (D3). Returns whether one was cancelled.
export async function cancelScheduledDeletion(tx: Transaction, hostAccountId: string, deps: AccountDeletionDependencies) {
  const [previous] = await tx<{ due: Date }[]>`
    with old as (
      select deletion_due_at as due from app.host_accounts
      where id = ${hostAccountId} and deletion_due_at is not null and deleted_at is null
      for no key update
    )
    update app.host_accounts a set deletion_due_at = null, updated_at = now()
    from old where a.id = ${hostAccountId}
    returning old.due
  `;
  if (!previous) return false;

  const email = await hostAddress(tx, hostAccountId);
  if (email) {
    await enqueueAccountEmail(tx, deps, {
      dedupeKey: `${hostAccountId}:${previous.due.toISOString()}`,
      kind: "account_deletion_cancelled",
      language: "en",
      parameters: { appUrl: appUrl(deps.origin), hostAccountId },
      recipient: email,
    });
  }
  return true;
}

export type HostDeletionOutcome =
  | { readonly status: "deleted"; readonly guestNotices: number }
  | { readonly status: "cancelled" | "not_due" | "missing" };

function postgresMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

// Runs a due, still-current schedule (D1, D4) in the job's transaction: the
// guest notices and the host's completion email are read before, and queued
// after, the operator function deletes everything they were read from.
export function createHostDeletionHandler(
  load: () => AccountDeletionDependencies = accountDeletionDependenciesFromEnvironment,
): JobHandler {
  return async (tx: Transaction, job: ClaimedJob): Promise<HostDeletionOutcome> => {
    const hostAccountId = typeof job.payload.hostAccountId === "string" ? job.payload.hostAccountId : null;
    const dueAt = typeof job.payload.dueAt === "string" ? job.payload.dueAt : null;
    if (!hostAccountId || !dueAt || !z.uuid().safeParse(hostAccountId).success) return { status: "missing" };

    const [account] = await tx<{ deleted_at: Date | null; deletion_due_at: Date | null; due: boolean }[]>`
      select deleted_at, deletion_due_at, deletion_due_at <= now() as due
      from app.host_accounts where id = ${hostAccountId} for no key update
    `;
    if (!account) return { status: "missing" };
    if (account.deleted_at || !account.deletion_due_at || account.deletion_due_at.getTime() !== new Date(dueAt).getTime()) {
      return { status: "cancelled" };
    }
    // A job is claimed only once its run_after, the due time, has passed on the
    // database's clock; anything else is retried rather than run early.
    if (!account.due) throw new CommandError("internal");

    const deps = load();
    const email = await hostAddress(tx, hostAccountId);
    const guests = await tx<{ id: string; contact_email: string; language: string | null; host_name: string | null }[]>`
      select r.id, r.contact_email, r.details ->> 'language' as language, s.settings ->> 'displayName' as host_name
      from app.requests r left join app.host_settings s on s.host_account_id = r.host_account_id
      where r.host_account_id = ${hostAccountId} and r.closed_at is null
        and r.state in ('gathering', 'negotiating', 'awaiting_host_approval', 'booking')
        and r.contact_email is not null
      order by r.id
    `;

    try {
      await tx`
        select * from app.operator_delete_host(
          ${hostAccountId}, ${SELF_SERVICE_OPERATOR}, ${SELF_SERVICE_REASON}, ${deploymentEnvironment()}
        )
      `;
    } catch (error) {
      // The booking worker may be writing an event: its outcome must be known
      // first, so the job backs off and the schedule stays (D4).
      if (/booking in flight/.test(postgresMessage(error))) throw new CommandError("booking_pending", { cause: error });
      throw error;
    }

    for (const guest of guests) {
      await enqueueAccountEmail(tx, deps, {
        dedupeKey: `${hostAccountId}:${guest.id}`,
        kind: "host_account_closed",
        language: guest.language === "ko" ? "ko" : "en",
        parameters: { hostAccountId, hostName: guest.host_name?.trim() || null },
        recipient: guest.contact_email,
      });
    }

    if (email) {
      await enqueueAccountEmail(tx, deps, {
        dedupeKey: hostAccountId,
        kind: "account_deletion_completed",
        language: "en",
        parameters: { hostAccountId },
        recipient: email,
      });
    }

    return { guestNotices: guests.length, status: "deleted" };
  };
}

const bodySchema = z.object({ confirmation: z.string().min(1).max(320), retryKey: z.uuid() }).strict();

// POST /api/host/account-deletion (D2): schedules the deletion, then signs the
// host out of every session and clears this browser's cookies.
export function createAccountDeletionHandler(
  load: () => ChatRouteDependencies = chatDependenciesFromEnvironment,
  loadDeletion: () => AccountDeletionDependencies = accountDeletionDependenciesFromEnvironment,
) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });
    if (refused) return refused;

    const userId = await verifiedUserId(request, deps.auth);
    if (!userId) return json({ code: "authentication_required", error: "Sign in to continue." }, 401);
    const standing = await readHostStanding(deps.db, userId);
    if (!standing.eligible || !standing.hostAccountId) {
      return json({ code: "host_ineligible", error: "Hosting is unavailable for this account." }, 403);
    }

    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ code: "invalid_input", error: "Type your handle to confirm." }, 400);

    const hostAccountId = standing.hostAccountId;
    const result = await runCommand(
      { authenticate: async () => ({ id: hostAccountId, kind: "host_account" }), db: deps.db },
      scheduleHostDeletionCommand(loadDeletion()),
      { input: { confirmation: body.data.confirmation }, resourceId: hostAccountId, retryKey: body.data.retryKey },
    );

    if (!result.ok) {
      if (result.error.category === "invalid_input") {
        return json({ code: "confirmation_mismatch", error: "That does not match your handle. Type it exactly as it appears." }, 400);
      }
      return json({ code: result.error.category, error: result.error.message }, result.error.category === "retry_conflict" ? 409 : 400);
    }

    const auth = createRequestAuthClient(request, deps.auth);
    // signOut reports failure in its result. Without the global revocation, this
    // browser's session is still cleared, so the host leaves either way.
    const { error } = await auth.client.auth.signOut({ scope: "global" }).catch((caught: unknown) => ({ error: caught }));
    if (error) await auth.client.auth.signOut({ scope: "local" }).catch(() => undefined);
    return auth.json({ dueAt: result.result.dueAt });
  };
}
