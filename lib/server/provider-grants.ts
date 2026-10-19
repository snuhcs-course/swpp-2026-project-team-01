import type { Queryable } from "./database";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

export type GoogleGrantUpdate = {
  readonly hostAccountId: string;
  // null when Google's granted scopes could not be read; nothing is recorded then.
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

export async function recordGoogleGrant(db: Queryable, key: TokenKey, update: GoogleGrantUpdate) {
  if (update.grantedScopes === null) {
    return;
  }

  const sealed = update.refreshToken
    ? sealToken(key, update.refreshToken, grantContext(update.hostAccountId))
    : null;

  await db`
    insert into app.provider_grants as stored (
      host_account_id, granted_scopes, refresh_token_ciphertext, refresh_token_key_id, scopes_checked_at
    ) values (
      ${update.hostAccountId}, ${update.grantedScopes as string[]},
      ${sealed?.ciphertext ?? null}, ${sealed?.keyId ?? null}, now()
    )
    on conflict (host_account_id) do update set
      granted_scopes = excluded.granted_scopes,
      refresh_token_ciphertext = coalesce(excluded.refresh_token_ciphertext, stored.refresh_token_ciphertext),
      refresh_token_key_id = coalesce(excluded.refresh_token_key_id, stored.refresh_token_key_id),
      scopes_checked_at = excluded.scopes_checked_at,
      updated_at = now()
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
