import { grantedCalendarScopes } from "../contracts/google-scopes";
import type { Queryable } from "./database";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

export type GoogleGrantUpdate = {
  readonly hostAccountId: string;
  // Scopes Google reported as granted, or null when they could not be read.
  // Only Calendar scopes are recorded. With none, the recorded scopes are left
  // as they were, because a later consent that omits them does not revoke an
  // earlier Google grant.
  readonly grantedScopes: readonly string[] | null;
  // Google returns a refresh token only on first consent; null keeps the stored one.
  readonly refreshToken: string | null;
};

export type StoredGoogleGrant = {
  readonly grantedScopes: readonly string[];
  readonly refreshToken: string | null;
};

function grantContext(hostAccountId: string) {
  return `provider_grant:google:${hostAccountId}`;
}

// Records what a sign-in returned. The refresh token is kept, sealed, even when
// the Calendar scopes were unchecked or unreadable: Google returns it only on the
// first consent, so a token dropped then would never come back when the host
// grants Calendar later. Its scopes are what the row records, never assumed. A
// fresh refresh token also clears an earlier invalidation, so reconnecting
// Calendar restores the grant.
export async function recordGoogleGrant(db: Queryable, key: TokenKey, update: GoogleGrantUpdate) {
  const calendarScopes = grantedCalendarScopes(update.grantedScopes ?? []);

  if (calendarScopes.length === 0 && !update.refreshToken) {
    return;
  }

  const sealed = update.refreshToken
    ? sealToken(key, update.refreshToken, grantContext(update.hostAccountId))
    : null;
  const hasScopes = calendarScopes.length > 0;

  await db`
    insert into app.provider_grants as stored (
      host_account_id, granted_scopes, refresh_token_ciphertext, refresh_token_key_id, scopes_checked_at
    ) values (
      ${update.hostAccountId}, ${calendarScopes},
      ${sealed?.ciphertext ?? null}, ${sealed?.keyId ?? null}, ${hasScopes ? new Date() : null}
    )
    on conflict (host_account_id) do update set
      granted_scopes = case when ${hasScopes} then excluded.granted_scopes else stored.granted_scopes end,
      refresh_token_ciphertext = coalesce(excluded.refresh_token_ciphertext, stored.refresh_token_ciphertext),
      refresh_token_key_id = coalesce(excluded.refresh_token_key_id, stored.refresh_token_key_id),
      scopes_checked_at = coalesce(excluded.scopes_checked_at, stored.scopes_checked_at),
      invalidated_at = case when excluded.refresh_token_ciphertext is null then stored.invalidated_at end,
      updated_at = now()
  `;
}

// Google rejected the stored refresh token (invalid_grant): the grant supports no
// Calendar-dependent step, and the host is not ready, until a sign-in records a
// fresh token.
export async function markGoogleGrantInvalid(db: Queryable, hostAccountId: string) {
  await db`
    update app.provider_grants
    set invalidated_at = now(), updated_at = now()
    where host_account_id = ${hostAccountId}
  `;
}

export async function readGoogleGrant(
  db: Queryable,
  keys: readonly TokenKey[],
  hostAccountId: string,
): Promise<StoredGoogleGrant | null> {
  const [row] = await db<
    { granted_scopes: string[]; refresh_token_ciphertext: string | null; refresh_token_key_id: string | null }[]
  >`
    select granted_scopes, refresh_token_ciphertext, refresh_token_key_id
    from app.provider_grants
    where host_account_id = ${hostAccountId}
  `;

  if (!row) {
    return null;
  }

  return {
    grantedScopes: row.granted_scopes,
    refreshToken:
      row.refresh_token_ciphertext && row.refresh_token_key_id
        ? openToken(
            keys,
            { ciphertext: row.refresh_token_ciphertext, keyId: row.refresh_token_key_id },
            grantContext(hostAccountId),
          )
        : null,
  };
}
