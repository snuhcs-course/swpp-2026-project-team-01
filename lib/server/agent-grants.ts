import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type AgentRole, type AgentScope, isAgentScope, roleScopes } from "../contracts/agent-access";
import type { AgentGrantView } from "../contracts/agent-access";
import { redirectHost } from "./agent-clients";
import { type AccessTokenClaims, type AgentSigningKey, randomToken, signAccessToken, tokenHash, verifiesChallenge } from "./agent-tokens";
import { type CommandDefinition, CommandError } from "./commands";
import type { Database, Queryable, Transaction } from "./database";

// Grants, codes and refresh families (agent-access D6, D11, design 5). A grant
// is a person's consent for one client; every call and refresh rechecks it and
// the authority under it. Codes are single-use and live 60 seconds; refresh
// tokens rotate on every use within a family whose 30-day boundary never moves.
// A replayed code or refresh token revokes the grant, so every token of that
// consent loses authority at once.

export const CODE_SECONDS = 60;
export const REFRESH_DAYS = 30;
export const BOOTSTRAP_HOURS = 24;

export type GrantRow = {
  readonly id: string;
  readonly client_id: string;
  readonly role: AgentRole;
  readonly host_account_id: string;
  readonly request_id: string | null;
  readonly bootstrap: boolean;
  readonly creation_retry_key: string | null;
  readonly scopes: AgentScope[];
  readonly resource: string;
  readonly source_hash: string;
};

export type NewGrant = {
  readonly clientId: string;
  readonly role: AgentRole;
  readonly hostAccountId: string;
  readonly requestId: string | null;
  readonly bootstrap: boolean;
  readonly scopes: readonly AgentScope[];
  readonly resource: string;
  readonly sourceHash: string;
};

// Records the grant and its code in the consent decision's transaction; returns
// the plaintext code for the redirect, which is never stored.
export async function createGrantWithCode(
  tx: Transaction,
  grant: NewGrant,
  code: { readonly redirectUri: string; readonly codeChallenge: string },
) {
  const [row] = await tx<{ id: string }[]>`
    insert into app.agent_grants (client_id, role, host_account_id, request_id, bootstrap, scopes, resource, source_hash, expires_at)
    values (${grant.clientId}, ${grant.role}, ${grant.hostAccountId}, ${grant.requestId}, ${grant.bootstrap},
            ${grant.scopes as string[]}, ${grant.resource}, ${grant.sourceHash},
            ${grant.bootstrap ? tx`now() + make_interval(hours => ${BOOTSTRAP_HOURS})` : null})
    returning id
  `;
  const plaintext = randomToken();
  await tx`
    insert into app.agent_authorization_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource, scopes, expires_at)
    values (${tokenHash(plaintext)}, ${row!.id}, ${grant.clientId}, ${code.redirectUri}, ${code.codeChallenge}, ${grant.resource},
            ${grant.scopes as string[]}, now() + make_interval(secs => ${CODE_SECONDS}))
  `;
  return { code: plaintext, grantId: row!.id };
}

export async function revokeGrant(db: Queryable, grantId: string, reason: "host" | "requester" | "client" | "family_replay" | "expired") {
  await db`
    update app.agent_grants set revoked_at = now(), revoke_reason = ${reason}
    where id = ${grantId} and revoked_at is null
  `;
  await db`update app.agent_refresh_tokens set revoked_at = now() where grant_id = ${grantId} and revoked_at is null`;
}

// ---------------------------------------------------------------------------
// The current authority behind a grant

export type GrantAccess = {
  readonly grantId: string;
  readonly clientId: string;
  readonly role: AgentRole;
  readonly scopes: readonly AgentScope[];
  readonly hostAccountId: string;
  readonly resource: string;
  readonly sourceHash: string;
  // The bound request, or null for an unbound bootstrap grant and host grants.
  readonly requestId: string | null;
  readonly bootstrap: boolean;
  readonly creationRetryKey: string | null;
  // The bound request has closed: only its closed status and receipt may be read.
  readonly closed: boolean;
};

// The grant's current access, or null when anything no longer holds: the grant
// is revoked or expired, its client disabled, the host account not active, or
// the bound request gone, of another host, or past its closed-access lifetime.
export async function currentGrantAccess(db: Queryable, grantId: string): Promise<GrantAccess | null> {
  const [row] = await db<
    (GrantRow & {
      live: boolean;
      client_disabled: boolean;
      host_status: string | null;
      request_host: string | null;
      request_open: boolean | null;
      link_valid: boolean | null;
      request_state: string | null;
    })[]
  >`
    select g.id, g.client_id, g.role, g.host_account_id, g.request_id, g.bootstrap, g.creation_retry_key, g.scopes,
           g.resource, g.source_hash,
           (g.revoked_at is null and (g.expires_at is null or g.expires_at > now())) as live,
           c.disabled_at is not null as client_disabled,
           a.status as host_status,
           r.host_account_id as request_host,
           r.state as request_state,
           (r.closed_at is null and r.expires_at > now() and l.expires_at > now()) as request_open,
           l.expires_at > now() as link_valid
    from app.agent_grants g
    join app.agent_clients c on c.id = g.client_id
    left join app.host_accounts a on a.id = g.host_account_id
    left join app.requests r on r.id = g.request_id
    left join app.booking_links l on l.request_id = g.request_id
    where g.id = ${grantId}
  `;

  if (!row || !row.live || row.client_disabled) return null;
  if (row.role === "host" && row.host_status !== "active") return null;

  let closed = false;

  if (row.role === "requester" && row.request_id) {
    if (row.request_host !== row.host_account_id || row.request_state === "draft" || !row.link_valid) return null;
    closed = !row.request_open;
  }

  return {
    bootstrap: row.bootstrap,
    clientId: row.client_id,
    closed,
    creationRetryKey: row.creation_retry_key,
    grantId: row.id,
    hostAccountId: row.host_account_id,
    requestId: row.request_id,
    resource: row.resource,
    role: row.role,
    scopes: row.scopes,
    sourceHash: row.source_hash,
  };
}

// Records use at most once a minute, for the connected agents list.
export async function touchGrant(db: Queryable, grantId: string) {
  await db`
    update app.agent_grants set last_used_at = now()
    where id = ${grantId} and (last_used_at is null or last_used_at < now() - interval '1 minute')
  `;
}

// The access an access token's verified claims give right now, or null.
export async function accessFromClaims(db: Queryable, claims: AccessTokenClaims) {
  const access = await currentGrantAccess(db, claims.grant_id);
  if (!access || access.clientId !== claims.client_id || access.resource !== claims.aud) return null;

  const scopes = claims.scope.split(" ").filter(isAgentScope);
  if (scopes.length === 0 || scopes.some((scope) => !access.scopes.includes(scope))) return null;

  return { ...access, scopes };
}

// ---------------------------------------------------------------------------
// The token endpoint

export type TokenError = {
  readonly error: "invalid_request" | "invalid_grant" | "invalid_client" | "unsupported_grant_type" | "invalid_scope" | "invalid_target" | "temporarily_unavailable";
  readonly description: string;
};

export type TokenSuccess = {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
};

function subject(access: GrantAccess) {
  return access.role === "host" ? `host:${access.hostAccountId}` : `grant:${access.grantId}`;
}

async function issueTokens(
  tx: Transaction,
  key: AgentSigningKey,
  issuer: string,
  access: GrantAccess,
  scopes: readonly AgentScope[],
  family: { readonly id: string; readonly expiresAt: Date | null },
): Promise<TokenSuccess> {
  const refresh = randomToken();
  await tx`
    insert into app.agent_refresh_tokens (token_hash, grant_id, family_id, client_id, resource, scopes, expires_at)
    values (${tokenHash(refresh)}, ${access.grantId}, ${family.id}, ${access.clientId}, ${access.resource}, ${scopes as string[]},
            ${family.expiresAt ?? tx`now() + make_interval(days => ${REFRESH_DAYS})`})
  `;
  const scope = scopes.join(" ");
  const access_token = signAccessToken(key, {
    aud: access.resource,
    client_id: access.clientId,
    grant_id: access.grantId,
    iss: issuer,
    scope,
    sub: subject(access),
  });
  return { access_token: access_token.token, expires_in: access_token.expiresIn, refresh_token: refresh, scope, token_type: "Bearer" };
}

const invalidGrant: TokenError = { description: "The grant is not valid.", error: "invalid_grant" };

export type CodeExchange = {
  readonly code: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly resource: string;
};

// authorization_code: consumes the code once. A consumed code presented again
// issues nothing and revokes its grant. The redirect URI, client, resource and
// PKCE verifier must all match the authorization request.
export async function exchangeCode(
  db: Database,
  key: AgentSigningKey,
  issuer: string,
  exchange: CodeExchange,
): Promise<TokenSuccess | TokenError> {
  return (await db.begin(async (tx) => {
    const hash = tokenHash(exchange.code);
    const [code] = await tx<
      {
        grant_id: string;
        client_id: string;
        redirect_uri: string;
        code_challenge: string;
        resource: string;
        scopes: AgentScope[];
        live: boolean;
      }[]
    >`
      update app.agent_authorization_codes set consumed_at = now()
      where code_hash = ${hash} and consumed_at is null
      returning grant_id, client_id, redirect_uri, code_challenge, resource, scopes, expires_at > now() as live
    `;

    if (!code) {
      const [replayed] = await tx<{ grant_id: string }[]>`
        select grant_id from app.agent_authorization_codes where code_hash = ${hash}
      `;
      if (replayed) await revokeGrant(tx, replayed.grant_id, "family_replay");
      return invalidGrant;
    }

    if (
      !code.live ||
      code.client_id !== exchange.clientId ||
      code.redirect_uri !== exchange.redirectUri ||
      code.resource !== exchange.resource ||
      !verifiesChallenge(exchange.codeVerifier, code.code_challenge)
    ) {
      return invalidGrant;
    }

    const access = await currentGrantAccess(tx, code.grant_id);
    if (!access) return invalidGrant;

    const family = randomUUID();
    await tx`update app.agent_authorization_codes set refresh_family_id = ${family} where code_hash = ${hash}`;
    return issueTokens(tx, key, issuer, access, code.scopes, { expiresAt: null, id: family });
  })) as TokenSuccess | TokenError;
}

export type RefreshExchange = {
  readonly refreshToken: string;
  readonly clientId: string;
  readonly resource: string;
  // A narrower scope, or null to keep the current one.
  readonly scope: readonly string[] | null;
};

// refresh_token: rotates within the family, keeping its resource, client and
// expiry; the scope may only narrow. A consumed or revoked token presented
// again revokes the grant.
export async function refreshTokens(
  db: Database,
  key: AgentSigningKey,
  issuer: string,
  exchange: RefreshExchange,
): Promise<TokenSuccess | TokenError> {
  return (await db.begin(async (tx) => {
    const [token] = await tx<
      {
        token_hash: string;
        grant_id: string;
        family_id: string;
        client_id: string;
        resource: string;
        scopes: AgentScope[];
        expires_at: Date;
        live: boolean;
        spent: boolean;
      }[]
    >`
      select token_hash, grant_id, family_id, client_id, resource, scopes, expires_at,
             expires_at > now() as live, (consumed_at is not null or revoked_at is not null) as spent
      from app.agent_refresh_tokens
      where token_hash = ${tokenHash(exchange.refreshToken)}
      for update
    `;

    if (!token) return invalidGrant;

    if (token.spent) {
      await revokeGrant(tx, token.grant_id, "family_replay");
      return invalidGrant;
    }

    if (!token.live || token.client_id !== exchange.clientId) return invalidGrant;
    if (token.resource !== exchange.resource) {
      return { description: "The resource does not match this grant.", error: "invalid_target" } satisfies TokenError;
    }

    const scopes = exchange.scope ?? token.scopes;
    if (scopes.length === 0 || scopes.some((scope) => !token.scopes.includes(scope as AgentScope))) {
      return { description: "The scope cannot be widened.", error: "invalid_scope" } satisfies TokenError;
    }

    const access = await currentGrantAccess(tx, token.grant_id);
    if (!access) return invalidGrant;

    await tx`update app.agent_refresh_tokens set consumed_at = now() where token_hash = ${token.token_hash}`;
    return issueTokens(tx, key, issuer, access, scopes as AgentScope[], { expiresAt: token.expires_at, id: token.family_id });
  })) as TokenSuccess | TokenError;
}

// RFC 7009: a refresh token of the client revokes its grant; anything else is
// ignored, and the caller always answers 200.
export async function revokeByRefreshToken(db: Queryable, refreshToken: string, clientId: string) {
  const [token] = await db<{ grant_id: string; client_id: string }[]>`
    select grant_id, client_id from app.agent_refresh_tokens where token_hash = ${tokenHash(refreshToken)}
  `;
  if (token && token.client_id === clientId) await revokeGrant(db, token.grant_id, "client");
}

export async function revokeByAccessToken(db: Queryable, claims: Pick<AccessTokenClaims, "grant_id" | "client_id">, clientId: string) {
  if (claims.client_id !== clientId) return;
  const [grant] = await db<{ client_id: string }[]>`select client_id from app.agent_grants where id = ${claims.grant_id}`;
  if (grant?.client_id === clientId) await revokeGrant(db, claims.grant_id, "client");
}

// ---------------------------------------------------------------------------
// Connected agents

type GrantListRow = {
  id: string;
  client_name: string;
  redirect_uri: string | null;
  redirect_uris: string[];
  scopes: AgentScope[];
  created_at: Date;
  last_used_at: Date | null;
};

function grantView(row: GrantListRow): AgentGrantView {
  return {
    clientName: row.client_name,
    connectedAt: row.created_at.toISOString(),
    id: row.id,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    redirectHost: redirectHost(row.redirect_uri ?? row.redirect_uris[0] ?? ""),
    scopes: row.scopes,
  };
}

// The host's live grants, newest first.
export async function listHostGrants(db: Queryable, hostAccountId: string) {
  const rows = await db<GrantListRow[]>`
    select g.id, c.client_name, c.redirect_uris, g.scopes, g.created_at, g.last_used_at,
           (select t.redirect_uri from app.agent_authorization_codes t where t.grant_id = g.id limit 1) as redirect_uri
    from app.agent_grants g join app.agent_clients c on c.id = g.client_id
    where g.host_account_id = ${hostAccountId} and g.role = 'host' and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
    order by g.created_at desc
  `;
  return rows.map(grantView);
}

// The live grants bound to one request, newest first.
export async function listRequestGrants(db: Queryable, requestId: string) {
  const rows = await db<GrantListRow[]>`
    select g.id, c.client_name, c.redirect_uris, g.scopes, g.created_at, g.last_used_at,
           (select t.redirect_uri from app.agent_authorization_codes t where t.grant_id = g.id limit 1) as redirect_uri
    from app.agent_grants g join app.agent_clients c on c.id = g.client_id
    where g.request_id = ${requestId} and g.role = 'requester' and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
    order by g.created_at desc
  `;
  return rows.map(grantView);
}

export function parseScopes(value: string | null, role: AgentRole): AgentScope[] | null {
  if (!value?.trim()) return null;
  const scopes = value.trim().split(/ +/);
  const allowed = roleScopes(role);
  if (new Set(scopes).size !== scopes.length || scopes.some((scope) => !(allowed as readonly string[]).includes(scope))) return null;
  return scopes as AgentScope[];
}

// ---------------------------------------------------------------------------
// agent.revoke_grant: **Revoke** in Connected agents. A host revokes its own
// host grants; a requester revokes the grants bound to its request. Any other
// grant, a revoked one included, answers like an unknown one.

const revokeInput = z.object({ grantId: z.uuid() }).strict();

export const REVOKE_GRANT_OPERATION = "agent.revoke_grant";

export const revokeGrantCommand: CommandDefinition<z.infer<typeof revokeInput>, { readonly revoked: true }> = {
  input: revokeInput,
  operation: REVOKE_GRANT_OPERATION,
  async run(tx, context) {
    const { actor } = context;
    const [grant] =
      actor.kind === "host_account"
        ? await tx<{ id: string }[]>`
            select id from app.agent_grants
            where id = ${context.input.grantId} and role = 'host' and host_account_id = ${actor.id} and revoked_at is null
            for update
          `
        : actor.kind === "requester_request" && actor.id === context.resourceId
          ? await tx<{ id: string }[]>`
              select id from app.agent_grants
              where id = ${context.input.grantId} and role = 'requester' and request_id = ${actor.id} and revoked_at is null
              for update
            `
          : [];

    if (!grant) throw new CommandError("forbidden");
    await revokeGrant(tx, grant.id, actor.kind === "host_account" ? "host" : "requester");
    return { revoked: true };
  },
};
