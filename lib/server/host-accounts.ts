import type { Queryable, Transaction } from "./database";

export type HostAccountStatus = "active" | "suspended";

export type HostAccount = {
  readonly created: boolean;
  readonly id: string;
  readonly status: HostAccountStatus;
};

export type GoogleIdentity = {
  readonly authUserId: string;
  readonly email: string;
  readonly googleSubject: string;
};

// Returns the one host account of a Google identity, creating it on first sign-in.
// The transaction-scoped advisory lock serializes concurrent callbacks for the
// same identity; the unique Google subject is the backstop. beforeCreate runs
// only when an account is about to be created (the sign-up bounds), and throwing
// from it creates nothing.
export async function ensureHostAccount(
  tx: Transaction,
  identity: GoogleIdentity,
  beforeCreate?: (tx: Transaction) => Promise<void>,
): Promise<HostAccount> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.google_identity:${identity.googleSubject}`}, 0))`;

  const [existing] = await tx<{ id: string; status: HostAccountStatus }[]>`
    select a.id, a.status
    from app.google_identities i
    join app.host_accounts a on a.id = i.host_account_id
    where i.google_subject = ${identity.googleSubject}
  `;

  if (existing) {
    return { created: false, id: existing.id, status: existing.status };
  }

  await beforeCreate?.(tx);

  const [account] = await tx<{ id: string; status: HostAccountStatus }[]>`
    insert into app.host_accounts default values returning id, status
  `;

  await tx`
    insert into app.google_identities (google_subject, host_account_id, auth_user_id, email)
    values (${identity.googleSubject}, ${account!.id}, ${identity.authUserId}, ${identity.email})
  `;

  return { created: true, id: account!.id, status: account!.status };
}

export async function findHostAccountByAuthUser(db: Queryable, authUserId: string) {
  const [row] = await db<{ id: string; status: HostAccountStatus }[]>`
    select a.id, a.status
    from app.google_identities i
    join app.host_accounts a on a.id = i.host_account_id
    where i.auth_user_id = ${authUserId}
  `;

  return row ?? null;
}
