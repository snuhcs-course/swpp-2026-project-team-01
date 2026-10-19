import type { Database, Transaction } from "./database";
import type { HostAccountStatus } from "./host-accounts";

// The shared eligibility-and-readiness guard. Hosting operations need an active
// host account; a public booking profile additionally needs completed setup
// (confirmed rules, timezone, unique handle and a writable booking destination).

export type NextHostAction = "sign_in" | "account_suspended" | "complete_setup";

export type HostStanding = {
  readonly hostAccountId: string | null;
  readonly eligible: boolean;
  readonly ready: boolean;
  readonly nextAction: NextHostAction | null;
};

export class HostIneligibleError extends Error {
  readonly nextAction: NextHostAction;

  constructor(nextAction: NextHostAction) {
    super(`Hosting is unavailable: ${nextAction}.`);
    this.name = "HostIneligibleError";
    this.nextAction = nextAction;
  }
}

async function readStanding(db: Database | Transaction, authUserId: string, lock: boolean): Promise<HostStanding> {
  const [row] = lock
    ? await db<{ id: string; status: HostAccountStatus }[]>`
        select a.id, a.status
        from app.google_identities i
        join app.host_accounts a on a.id = i.host_account_id
        where i.auth_user_id = ${authUserId}
        for share of a
      `
    : await db<{ id: string; status: HostAccountStatus }[]>`
        select a.id, a.status
        from app.google_identities i
        join app.host_accounts a on a.id = i.host_account_id
        where i.auth_user_id = ${authUserId}
      `;

  if (!row) {
    return { eligible: false, hostAccountId: null, nextAction: "sign_in", ready: false };
  }

  if (row.status !== "active") {
    return { eligible: false, hostAccountId: row.id, nextAction: "account_suspended", ready: false };
  }

  // No setup can be saved before host onboarding (Phase 2) adds settings, so an
  // active host is never ready yet and its next action is to complete setup.
  return { eligible: true, hostAccountId: row.id, nextAction: "complete_setup", ready: false };
}

export function readHostStanding(db: Database, authUserId: string) {
  return readStanding(db, authUserId, false);
}

// The standing inside a transaction, with the account row share-locked until it
// ends, for operations (such as commands) that recheck authority themselves.
export function lockHostStanding(tx: Transaction, authUserId: string) {
  return readStanding(tx, authUserId, true);
}

export function hasPublicProfile(standing: HostStanding) {
  return standing.eligible && standing.ready;
}

// Runs a hosting operation in one transaction only when the host is active. The
// account row is share-locked, so a concurrent suspension waits for the operation
// and the operation never runs against a suspended account.
export async function withEligibleHost<T>(
  db: Database,
  authUserId: string,
  operation: (tx: Transaction, hostAccountId: string) => Promise<T>,
): Promise<T> {
  return (await db.begin(async (tx) => {
    const standing = await lockHostStanding(tx, authUserId);

    if (!standing.eligible || !standing.hostAccountId) {
      throw new HostIneligibleError(standing.nextAction ?? "sign_in");
    }

    return operation(tx, standing.hostAccountId);
  })) as T;
}

// Runs an operation for a known host account in one transaction only while the
// account is active, with its row share-locked as withEligibleHost does. For work
// that starts from the account rather than from a browser session, such as
// delivering a discussion's next input when a turn ends.
export async function withActiveHostAccount<T>(
  db: Database,
  hostAccountId: string,
  operation: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return (await db.begin(async (tx) => {
    const [row] = await tx<{ status: HostAccountStatus }[]>`
      select status from app.host_accounts where id = ${hostAccountId} for share
    `;

    if (row?.status !== "active") {
      throw new HostIneligibleError(row ? "account_suspended" : "sign_in");
    }

    return operation(tx);
  })) as T;
}
