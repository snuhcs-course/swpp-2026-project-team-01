import { randomBytes, randomUUID } from "node:crypto";
import { GOOGLE_CALENDAR_SCOPES } from "../../../lib/contracts/google-scopes";
import type { Database } from "../../../lib/server/database";
import { assignHandle } from "../../../lib/server/handles";
import { parseTokenKey, sealToken } from "../../../lib/server/token-encryption";

// Makes a host ready the way confirmation leaves it: confirmed settings with a
// verified booking calendar, a current handle and a Calendar grant that can write
// events. Suites that need a public host use this instead of the setup flow.

export function uniqueHandle(prefix = "host") {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export async function newHostAccount(db: Database) {
  const [row] = await db<{ id: string }[]>`insert into app.host_accounts default values returning id`;
  return row!.id;
}

export async function makeHostReady(
  db: Database,
  hostAccountId: string,
  { displayName = "Ada Lovelace", handle = uniqueHandle() }: { displayName?: string; handle?: string } = {},
) {
  const key = parseTokenKey(randomBytes(32).toString("base64"));
  const sealed = sealToken(key, `1//${randomUUID()}`, `provider_grant:google:${hostAccountId}`);
  const settings = {
    bookingCalendar: { accessRole: "owner", id: `${handle}@example.test`, summary: "Work", verifiedAt: new Date().toISOString() },
    displayName,
    handle,
  };

  await db.begin(async (tx) => {
    await tx`
      insert into app.host_settings (host_account_id, settings, draft_revision)
      values (${hostAccountId}, ${tx.json(settings)}, 1)
      on conflict (host_account_id) do update set settings = excluded.settings
    `;
    await assignHandle(tx, hostAccountId, handle);
    await tx`
      insert into app.provider_grants
        (host_account_id, granted_scopes, refresh_token_ciphertext, refresh_token_key_id, scopes_checked_at)
      values (${hostAccountId}, ${[...GOOGLE_CALENDAR_SCOPES]}, ${sealed.ciphertext}, ${sealed.keyId}, now())
      on conflict (host_account_id) do update set
        granted_scopes = excluded.granted_scopes,
        refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        refresh_token_key_id = excluded.refresh_token_key_id,
        invalidated_at = null
    `;
  });

  return { displayName, handle };
}
