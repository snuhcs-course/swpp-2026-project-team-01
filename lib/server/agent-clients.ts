import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import type { Database, Queryable } from "./database";
import { AGENT_LIMITS, admitAttempt, AttemptLimitError } from "./agent-limits";

// Agent OAuth clients (agent-access D2, D15, design 3). Three kinds:
//   - the first-party CLI client fmat-cli, defined here, whose redirects are a
//     loopback callback and each listed origin's /connect/code page;
//   - a client ID metadata document: an https URL with a path, fetched from a
//     public address without redirects, at most 5 KB within 5 seconds, accepted
//     only when its client_id equals the URL, and cached for its max-age (5
//     minutes to 24 hours);
//   - a dynamically registered client (RFC 7591), dcr_ followed by random bytes.
// None of them grants anything: a client acts only through a person's consent.

export const FIRST_PARTY_CLIENT_ID = "fmat-cli";
export const FIRST_PARTY_CLIENT_NAME = "Find Me a Time CLI";

export type AgentClient = {
  readonly id: string;
  readonly kind: "first_party" | "registered" | "metadata_document";
  readonly name: string;
  readonly clientUri: string | null;
  readonly redirectUris: readonly string[];
};

export class ClientResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientResolutionError";
  }
}

// ---------------------------------------------------------------------------
// Redirect URIs

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// An https URL, or a loopback http URL, with no fragment or credentials.
export function isValidRedirectUri(value: string) {
  if (value.length > 2000) return false;
  const url = parseUrl(value);
  if (!url || url.hash || value.includes("#") || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

// Exact match of scheme, host, path and query. A loopback redirect's port may
// differ from the registered one, as OAuth 2.1 requires for native clients.
// This includes localhost: Claude Code's client ID metadata document registers
// http://localhost/callback and returns to a free port on it.
export function matchesRedirectUri(registered: readonly string[], requested: string) {
  if (!isValidRedirectUri(requested)) return false;
  if (registered.includes(requested)) return true;

  const wanted = parseUrl(requested)!;
  if (wanted.protocol !== "http:" || !LOOPBACK_HOSTS.has(wanted.hostname)) return false;

  return registered.some((candidate) => {
    const url = parseUrl(candidate);
    return (
      url !== null &&
      url.protocol === "http:" &&
      url.hostname === wanted.hostname &&
      url.pathname === wanted.pathname &&
      url.search === wanted.search
    );
  });
}

export function redirectHost(uri: string) {
  return parseUrl(uri)?.host ?? uri;
}

export function isLocalRedirect(uri: string) {
  const url = parseUrl(uri);
  return url !== null && LOOPBACK_HOSTS.has(url.hostname);
}

// ---------------------------------------------------------------------------
// The first-party client

export function firstPartyRedirectUris(origins: readonly string[]) {
  return ["http://127.0.0.1/callback", "http://[::1]/callback", ...origins.map((origin) => `${origin}/connect/code`)];
}

async function ensureFirstParty(db: Queryable, origins: readonly string[]): Promise<AgentClient> {
  const redirectUris = firstPartyRedirectUris(origins);
  await db`
    insert into app.agent_clients (id, kind, client_name, redirect_uris)
    values (${FIRST_PARTY_CLIENT_ID}, 'first_party', ${FIRST_PARTY_CLIENT_NAME}, ${redirectUris})
    on conflict (id) do update set redirect_uris = excluded.redirect_uris, updated_at = now()
    where app.agent_clients.redirect_uris is distinct from excluded.redirect_uris
  `;
  return { clientUri: null, id: FIRST_PARTY_CLIENT_ID, kind: "first_party", name: FIRST_PARTY_CLIENT_NAME, redirectUris };
}

// ---------------------------------------------------------------------------
// Client ID metadata documents

export const METADATA_LIMITS = { bytes: 5 * 1024, timeoutMs: 5000, minCacheSeconds: 300, maxCacheSeconds: 86_400 } as const;

// Addresses a metadata fetch must never reach: loopback, private, link-local,
// shared, multicast, reserved and unspecified ranges, in IPv4 and IPv6.
export function isPublicAddress(address: string) {
  const family = isIP(address);

  if (family === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number, number, number];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }

  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !(
      lower === "::" ||
      lower === "::1" ||
      /^f[cd]/.test(lower) ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith("ff") ||
      lower.startsWith("::ffff:") ||
      lower.startsWith("64:ff9b:")
    );
  }

  return false;
}

// Whether a client_id names a metadata document this server may fetch.
export function isMetadataDocumentUrl(clientId: string) {
  const url = parseUrl(clientId);
  return Boolean(
    url &&
      url.protocol === "https:" &&
      url.pathname.length > 1 &&
      !url.hash &&
      !clientId.includes("#") &&
      !url.username &&
      !url.password &&
      url.port === "" &&
      isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0 &&
      url.hostname.includes(".") &&
      !url.hostname.endsWith(".localhost") &&
      clientId.length <= 2000,
  );
}

export type MetadataFetch = (url: string) => Promise<{ readonly body: string; readonly maxAgeSeconds: number | null }>;

async function readLimited(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ClientResolutionError("The client metadata document is too large.");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function maxAge(cacheControl: string | null) {
  const match = cacheControl?.match(/(?:^|,)\s*max-age=(\d+)/i);
  return match ? Number(match[1]) : null;
}

// The production fetcher: every resolved address must be public, then a GET
// that follows no redirect, within the time and size limits.
export const fetchMetadataDocument: MetadataFetch = async (url) => {
  const { hostname } = new URL(url);
  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);

  if (addresses.length === 0 || !addresses.every((entry) => isPublicAddress(entry.address))) {
    throw new ClientResolutionError("The client metadata document is not on a public address.");
  }

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(METADATA_LIMITS.timeoutMs),
  }).catch(() => {
    throw new ClientResolutionError("The client metadata document could not be fetched.");
  });

  if (!response.ok) throw new ClientResolutionError("The client metadata document could not be fetched.");
  return { body: await readLimited(response, METADATA_LIMITS.bytes), maxAgeSeconds: maxAge(response.headers.get("cache-control")) };
};

const metadataDocument = z.object({
  client_id: z.string(),
  client_name: z.string().trim().min(1).max(200),
  client_uri: z.string().max(2000).optional(),
  redirect_uris: z.array(z.string()).min(1).max(10),
});

export function parseMetadataDocument(clientId: string, body: string) {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ClientResolutionError("The client metadata document is not JSON.");
  }

  const parsed = metadataDocument.safeParse(json);
  if (!parsed.success) throw new ClientResolutionError("The client metadata document lacks required fields.");
  if (parsed.data.client_id !== clientId) throw new ClientResolutionError("The client metadata document names another client.");
  if (!parsed.data.redirect_uris.every(isValidRedirectUri)) {
    throw new ClientResolutionError("The client metadata document lists a redirect URI that is not allowed.");
  }

  const clientUri = parsed.data.client_uri && parseUrl(parsed.data.client_uri)?.protocol === "https:" ? parsed.data.client_uri : null;
  return { clientUri, name: parsed.data.client_name, redirectUris: parsed.data.redirect_uris };
}

// ---------------------------------------------------------------------------
// Resolution

type ClientRow = {
  id: string;
  kind: AgentClient["kind"];
  client_name: string;
  client_uri: string | null;
  redirect_uris: string[];
  disabled_at: Date | null;
  fresh: boolean;
};

function fromRow(row: ClientRow): AgentClient {
  return { clientUri: row.client_uri, id: row.id, kind: row.kind, name: row.client_name, redirectUris: row.redirect_uris };
}

export type ClientDependencies = {
  readonly db: Database;
  readonly fetchMetadata?: MetadataFetch;
};

// The client a client_id names, or a ClientResolutionError: unknown,
// disabled, or a metadata document that cannot be fetched or does not hold.
export async function resolveClient(deps: ClientDependencies, clientId: string, origins: readonly string[]): Promise<AgentClient> {
  if (clientId === FIRST_PARTY_CLIENT_ID) return ensureFirstParty(deps.db, origins);

  const [row] = await deps.db<ClientRow[]>`
    select id, kind, client_name, client_uri, redirect_uris, disabled_at,
           coalesce(metadata_expires_at > now(), true) as fresh
    from app.agent_clients where id = ${clientId}
  `;

  if (row?.disabled_at) throw new ClientResolutionError("This client is disabled.");
  if (row && (row.kind !== "metadata_document" || row.fresh)) return fromRow(row);
  if (!isMetadataDocumentUrl(clientId)) throw new ClientResolutionError("This client is not registered.");

  try {
    await admitAttempt(deps.db, "metadata_fetch", [{ bound: AGENT_LIMITS.metadataFetchPerClient, key: clientId }]);
  } catch (error) {
    if (error instanceof AttemptLimitError) throw new ClientResolutionError("The client metadata document was fetched too often.");
    throw error;
  }

  const fetched = await (deps.fetchMetadata ?? fetchMetadataDocument)(clientId).catch((error: unknown) => {
    throw error instanceof ClientResolutionError ? error : new ClientResolutionError("The client metadata document could not be fetched.");
  });
  const document = parseMetadataDocument(clientId, fetched.body);
  const seconds = Math.min(METADATA_LIMITS.maxCacheSeconds, Math.max(METADATA_LIMITS.minCacheSeconds, fetched.maxAgeSeconds ?? 0));

  await deps.db`
    insert into app.agent_clients (id, kind, client_name, client_uri, redirect_uris, metadata_fetched_at, metadata_expires_at)
    values (${clientId}, 'metadata_document', ${document.name}, ${document.clientUri}, ${document.redirectUris},
            now(), now() + make_interval(secs => ${seconds}))
    on conflict (id) do update set
      client_name = excluded.client_name, client_uri = excluded.client_uri, redirect_uris = excluded.redirect_uris,
      metadata_fetched_at = excluded.metadata_fetched_at, metadata_expires_at = excluded.metadata_expires_at, updated_at = now()
  `;

  return { clientUri: document.clientUri, id: clientId, kind: "metadata_document", name: document.name, redirectUris: document.redirectUris };
}

// ---------------------------------------------------------------------------
// Dynamic client registration (RFC 7591)

const registrationInput = z.object({
  client_name: z.string().trim().min(1).max(200).optional(),
  client_uri: z.string().max(2000).optional(),
  redirect_uris: z.array(z.string()).min(1).max(10),
  grant_types: z.array(z.string()).max(5).optional(),
  response_types: z.array(z.string()).max(5).optional(),
  token_endpoint_auth_method: z.string().max(64).optional(),
  application_type: z.string().max(32).optional(),
  scope: z.string().max(500).optional(),
});

export type RegistrationResult =
  | { readonly ok: true; readonly status: 201; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly status: 400 | 429; readonly body: Record<string, unknown>; readonly retryAfterSeconds?: number };

export async function registerClient(db: Database, input: unknown, sourceHash: string): Promise<RegistrationResult> {
  const parsed = registrationInput.safeParse(input);

  if (!parsed.success) {
    return { body: { error: "invalid_client_metadata", error_description: "The client metadata is not valid." }, ok: false, status: 400 };
  }
  if (!parsed.data.redirect_uris.every(isValidRedirectUri)) {
    return {
      body: { error: "invalid_redirect_uri", error_description: "Redirect URIs must be https or loopback http, without fragments." },
      ok: false,
      status: 400,
    };
  }

  const grantTypes = parsed.data.grant_types ?? ["authorization_code", "refresh_token"];
  const responseTypes = parsed.data.response_types ?? ["code"];

  if (!grantTypes.includes("authorization_code") || grantTypes.some((type) => type !== "authorization_code" && type !== "refresh_token")) {
    return { body: { error: "invalid_client_metadata", error_description: "Only authorization_code and refresh_token are supported." }, ok: false, status: 400 };
  }
  if (responseTypes.some((type) => type !== "code")) {
    return { body: { error: "invalid_client_metadata", error_description: "Only the code response type is supported." }, ok: false, status: 400 };
  }

  try {
    await admitAttempt(db, "registration", [
      { bound: AGENT_LIMITS.registrationPerSource, key: sourceHash },
      { bound: AGENT_LIMITS.registrationService, key: "service" },
    ]);
  } catch (error) {
    if (error instanceof AttemptLimitError) {
      return {
        body: { error: "temporarily_unavailable", error_description: "Too many registrations. Try again later." },
        ok: false,
        retryAfterSeconds: error.retryAfterSeconds,
        status: 429,
      };
    }
    throw error;
  }

  const clientId = `dcr_${randomBytes(18).toString("base64url")}`;
  const name = parsed.data.client_name ?? "Unnamed agent";
  const clientUri = parsed.data.client_uri && parseUrl(parsed.data.client_uri)?.protocol === "https:" ? parsed.data.client_uri : null;
  const [row] = await db<{ created_at: Date }[]>`
    insert into app.agent_clients (id, kind, client_name, client_uri, redirect_uris, registration_source_hash)
    values (${clientId}, 'registered', ${name}, ${clientUri}, ${parsed.data.redirect_uris}, ${sourceHash})
    returning created_at
  `;

  return {
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(row!.created_at.getTime() / 1000),
      client_name: name,
      ...(clientUri ? { client_uri: clientUri } : {}),
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: parsed.data.redirect_uris,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    ok: true,
    status: 201,
  };
}
