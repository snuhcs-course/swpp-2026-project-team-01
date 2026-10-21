import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseCookieHeader } from "@supabase/ssr";
import { REQUEST_LANGUAGES, type RequestLanguage } from "../contracts/request";
import { isValidTimeZone } from "../contracts/timezone";
import { bookingUrl, findRequestByBookingId } from "./booking-links";
import { CommandError } from "./commands";
import { REQUESTER_HEADERS } from "./confirmation-routes";
import { database, type Database } from "./database";
import { deploymentEnvironment } from "./deployment";
import { GOOGLE_OAUTH_TOKEN_URL } from "./google-calendar";
import { createGrantedScopesFetcher, type FetchGrantedScopes, GOOGLE_TOKEN_INFO_URL } from "./google-token-info";
import { internalSigningKey } from "./internal-bearer";
import { lockOpenRequest } from "./request-guard";
import { identifyDraft, openRequestBookingId } from "./request-start";
import { REQUESTER_CALENDAR_SCOPES } from "./requester-calendar";
import { recordRequesterGrants, type RequesterGoogleIdentity } from "./requester-grants";
import { type AppOrigins, appOriginsFromEnvironment, crossSiteRefusal, requestAppOrigin, unknownHost } from "./same-origin";
import { openToken, sealToken, type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// The requester's Google consent (design decision 3; requester-calendar-access:
// request-bound Google consent flow). It is the application's own OAuth 2.0
// round trip, so it never creates a Supabase user, a host account or a product
// session. It may share the host sign-in OAuth client: requester grants are
// delete-only and never revoked at Google, so closing one never touches the same
// person's host Calendar grant.
//
//   POST /connections/google/start   from the guest thread, on /{handle} while
//     the request is a draft or on the booking page after, with the booking
//     identifier the page holds, which proves the link (purpose request). It
//     records a transaction with a hashed random state, a sealed PKCE verifier
//     and a hashed browser binding, sets the binding in an HttpOnly cookie
//     scoped to /connections/google for 10 minutes and redirects to Google.
//   GET /connections/google/callback  claims the transaction once (unconsumed,
//     unexpired, the same browser), then exchanges the code with the verifier,
//     reads the ID token claims and the granted scopes, and records the grants.
//     A draft is identified with the Google name and email at the same time
//     (design decision 2), and the browser continues the same thread at the
//     booking link. A cancelled consent returns to where it started (the public
//     page for a draft) with nothing recorded. Every other failure consumes
//     nothing it did not claim and reveals no request. Transactions with the
//     purpose intake, from before D13, are refused.

export const REQUESTER_GOOGLE_SCOPES = ["openid", "email", "profile", ...REQUESTER_CALENDAR_SCOPES] as const;
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const BINDING_COOKIE = "fmat_google_binding";
export const BINDING_PATH = "/connections/google";
export const TRANSACTION_SECONDS = 600;

type Environment = Readonly<Record<string, string | undefined>>;

export type RequesterGoogleConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authUrl: string;
  readonly tokenUrl: string;
  readonly fetch?: typeof fetch;
};

// The requester client is GOOGLE_REQUESTER_CLIENT_ID/SECRET, falling back to the
// host sign-in client (GOOGLE_CLIENT_ID/SECRET) when unset. Stand-in URLs
// (GOOGLE_REQUESTER_AUTH_URL, GOOGLE_OAUTH_TOKEN_URL) are honored only outside
// production, like the host Calendar client's.
export function requesterGoogleConfigFromEnvironment(env: Environment = process.env): RequesterGoogleConfig {
  const overridable = deploymentEnvironment(env) !== "production";

  return {
    authUrl: (overridable && env.GOOGLE_REQUESTER_AUTH_URL?.trim()) || GOOGLE_AUTH_URL,
    clientId: (env.GOOGLE_REQUESTER_CLIENT_ID?.trim() || env.GOOGLE_CLIENT_ID?.trim()) ?? "",
    clientSecret: (env.GOOGLE_REQUESTER_CLIENT_SECRET?.trim() || env.GOOGLE_CLIENT_SECRET?.trim()) ?? "",
    tokenUrl: (overridable && env.GOOGLE_OAUTH_TOKEN_URL?.trim()) || GOOGLE_OAUTH_TOKEN_URL,
  };
}

export function tokenInfoUrlFromEnvironment(env: Environment = process.env) {
  return (deploymentEnvironment(env) !== "production" && env.GOOGLE_TOKEN_INFO_URL?.trim()) || GOOGLE_TOKEN_INFO_URL;
}

export type RequesterGoogleDependencies = AppOrigins & {
  readonly db: Database;
  readonly google: RequesterGoogleConfig;
  readonly fetchGrantedScopes: FetchGrantedScopes;
  readonly tokenKey: TokenKey;
  readonly signingKey: string;
};

export function requesterGoogleDependenciesFromEnvironment(): RequesterGoogleDependencies {
  return {
    ...appOriginsFromEnvironment(),
    db: database(),
    fetchGrantedScopes: createGrantedScopesFetcher(tokenInfoUrlFromEnvironment()),
    google: requesterGoogleConfigFromEnvironment(),
    signingKey: internalSigningKey(),
    tokenKey: tokenKeyFromEnvironment(),
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function verifierContext(transactionId: string) {
  return `requester_oauth:${transactionId}`;
}

function redirect(location: string, extra: Record<string, string> = {}) {
  return new Response(null, { headers: { ...REQUESTER_HEADERS, location, ...extra }, status: 303 });
}

function bindingCookie(value: string, origin: string, maxAge: number) {
  const secure = origin.startsWith("https:") ? "; Secure" : "";
  return `${BINDING_COOKIE}=${value}; Path=${BINDING_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

// A readable failure that names no request: the visitor starts again from the
// host's public page (when the transaction named one) or from the home page.
function failurePage(handle: string | null, status = 400) {
  const back = handle ? `/${handle}` : "/";
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Google sign-in could not finish</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5">
<h1 style="font-size: 1.5rem">Google sign-in could not finish</h1>
<p>This sign-in link was already used, has expired or was opened in another browser. Nothing was changed.</p>
<p><a href="${back}">Start again</a> from the page you came from, or continue without Google.</p>
</body></html>`;

  return new Response(body, { headers: { ...REQUESTER_HEADERS, "content-type": "text/html; charset=utf-8" }, status });
}

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function language(value: string): RequestLanguage {
  return (REQUEST_LANGUAGES as readonly string[]).includes(value) ? (value as RequestLanguage) : "en";
}

// POST /connections/google/start
export function createGoogleStartHandler(load: () => RequesterGoogleDependencies = requesterGoogleDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const origin = requestAppOrigin(request, deps);

    if (!origin) return unknownHost();

    const refused = crossSiteRefusal(request, deps, { json: false });

    if (refused) return refused;

    const form = await request.formData().catch(() => null);

    if (!form || !deps.google.clientId) return failurePage(null, form ? 503 : 400);

    const purpose = field(form, "purpose");
    const timezone = field(form, "timezone");
    const draft = {
      language: language(field(form, "language")),
      timezone: isValidTimeZone(timezone) ? timezone : "UTC",
    };
    if (purpose !== "request") return failurePage(null);

    const link = await findRequestByBookingId(deps.db, field(form, "bookingId"));
    const [open] = link && !link.expired
      ? await deps.db<{ host_account_id: string }[]>`
          select host_account_id from app.requests where id = ${link.requestId} and closed_at is null and expires_at > now()
        `
      : [];

    if (!open) return failurePage(null, 404);

    const target = { hostAccountId: open.host_account_id, requestId: link!.requestId };

    const state = randomBytes(32).toString("base64url");
    const binding = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const transactionId = randomUUID();
    const sealed = sealToken(deps.tokenKey, verifier, verifierContext(transactionId));

    await deps.db`
      insert into app.requester_oauth_transactions
        (id, state_hash, binding_hash, verifier_ciphertext, verifier_key_id, purpose, host_account_id, intake_id,
         request_id, draft, expires_at)
      values
        (${transactionId}, ${sha256(state)}, ${sha256(binding)}, ${sealed.ciphertext}, ${sealed.keyId}, ${purpose},
         ${target.hostAccountId}, ${null}, ${target.requestId}, ${deps.db.json(draft)},
         now() + make_interval(secs => ${TRANSACTION_SECONDS}))
    `;

    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = new URL(deps.google.authUrl);
    authorize.search = new URLSearchParams({
      access_type: "offline",
      client_id: deps.google.clientId,
      code_challenge: challenge,
      code_challenge_method: "S256",
      include_granted_scopes: "false",
      prompt: "consent",
      redirect_uri: `${origin}${BINDING_PATH}/callback`,
      response_type: "code",
      scope: REQUESTER_GOOGLE_SCOPES.join(" "),
      state,
    }).toString();

    return redirect(authorize.toString(), { "set-cookie": bindingCookie(binding, origin, TRANSACTION_SECONDS) });
  };
}

type ClaimedTransaction = {
  readonly id: string;
  readonly purpose: "intake" | "request";
  readonly host_account_id: string;
  readonly intake_id: string | null;
  readonly request_id: string | null;
  readonly draft: { readonly timezone?: string; readonly language?: RequestLanguage } | null;
  readonly verifier_ciphertext: string;
  readonly verifier_key_id: string;
};

function decodeIdToken(idToken: unknown) {
  if (typeof idToken !== "string") return null;

  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    return typeof claims.sub === "string" && claims.sub ? claims : null;
  } catch {
    return null;
  }
}

// Exchanges the authorization code with the PKCE verifier. The ID token comes
// straight from Google's token endpoint over TLS, so its claims are read without
// a separate signature check, as Google's OpenID guide allows for this flow.
async function exchangeCode(
  deps: RequesterGoogleDependencies,
  origin: string,
  code: string,
  verifier: string,
): Promise<RequesterGoogleIdentity | null> {
  try {
    const response = await (deps.google.fetch ?? fetch)(deps.google.tokenUrl, {
      body: new URLSearchParams({
        client_id: deps.google.clientId,
        client_secret: deps.google.clientSecret,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: `${origin}${BINDING_PATH}/callback`,
      }),
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (!response.ok || !body || typeof body.access_token !== "string") return null;

    const claims = decodeIdToken(body.id_token);

    if (!claims) return null;

    const scopes = await deps.fetchGrantedScopes(body.access_token);
    const rawName = typeof claims.name === "string" ? claims.name : null;
    // oxlint-disable-next-line no-control-regex -- removing control characters is the point
    const name = rawName?.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 200).trim() || null;

    return {
      email: typeof claims.email === "string" ? claims.email.slice(0, 320) : null,
      emailVerified: claims.email_verified === true || claims.email_verified === "true",
      name,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
      scopes,
      subject: claims.sub as string,
    };
  } catch {
    return null;
  }
}

async function handleOf(db: Database, hostAccountId: string) {
  const [row] = await db<{ handle: string }[]>`
    select handle from app.host_handles where host_account_id = ${hostAccountId} and released_at is null
  `;
  return row?.handle ?? null;
}

// GET /connections/google/callback
export function createGoogleCallbackHandler(load: () => RequesterGoogleDependencies = requesterGoogleDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const origin = requestAppOrigin(request, deps);

    if (!origin) return unknownHost();

    const url = new URL(request.url);
    const state = url.searchParams.get("state") ?? "";
    const binding =
      parseCookieHeader(request.headers.get("cookie") ?? "").find((cookie) => cookie.name === BINDING_COOKIE)?.value ?? "";
    const clear = { "set-cookie": bindingCookie("", origin, 0) };

    if (!state) return failurePage(null);

    // Single use: the claim consumes the transaction only for its own browser,
    // before anything else happens, so a replay or another browser changes nothing.
    const [claimed] = !binding ? [] : await deps.db<ClaimedTransaction[]>`
      update app.requester_oauth_transactions
      set consumed_at = now()
      where state_hash = ${sha256(state)} and binding_hash = ${sha256(binding)}
        and consumed_at is null and expires_at > now()
      returning id, purpose, host_account_id, intake_id, request_id, draft, verifier_ciphertext, verifier_key_id
    `;

    if (!claimed) {
      const [known] = await deps.db<{ host_account_id: string; purpose: string }[]>`
        select host_account_id, purpose from app.requester_oauth_transactions where state_hash = ${sha256(state)}
      `;
      return failurePage(known ? await handleOf(deps.db, known.host_account_id) : null);
    }

    const handle = await handleOf(deps.db, claimed.host_account_id);

    if (claimed.purpose !== "request" || !claimed.request_id) return failurePage(handle);

    const requestId = claimed.request_id;
    // A draft's thread lives on the public page until the guest is identified;
    // its booking link never reaches the address bar before then.
    const returnTo = async (query: string) => {
      const [request] = await deps.db<{ state: string }[]>`select state from app.requests where id = ${requestId}`;
      const bookingId = request && request.state !== "draft" ? await openRequestBookingId(deps.db, [deps.tokenKey], requestId) : null;
      return bookingId
        ? redirect(`${bookingUrl(origin, bookingId)}?google=${query}`, clear)
        : redirect(`${origin}/${handle ?? ""}?google=${query}`, clear);
    };

    // A cancelled consent records nothing and returns to the conversation.
    if (url.searchParams.get("error") || !url.searchParams.get("code")) return returnTo("cancelled");

    const verifier = openToken(
      [deps.tokenKey],
      { ciphertext: claimed.verifier_ciphertext, keyId: claimed.verifier_key_id },
      verifierContext(claimed.id),
    );
    const identity = await exchangeCode(deps, origin, url.searchParams.get("code")!, verifier);

    if (!identity) return failurePage(handle);

    // The request, still open with its link unexpired, under its lock: a
    // draft is identified with the Google name and email, an identified request
    // records the grants.
    const recorded = await deps.db
      .begin(async (tx) => {
        const request = await lockOpenRequest(tx, requestId);

        if (request.state === "draft") {
          if (!identity.email) return null;
          await identifyDraft(
            tx,
            request,
            {
              email: identity.email,
              google: identity,
              language: claimed.draft?.language,
              name: identity.name ?? identity.email.split("@")[0]!.slice(0, 200),
              timezone: claimed.draft?.timezone && isValidTimeZone(claimed.draft.timezone) ? claimed.draft.timezone : "UTC",
            },
            { origin, tokenKey: deps.tokenKey },
          );
          return "identified";
        }

        await recordRequesterGrants(tx, deps.tokenKey, request.id, identity);
        return "connected";
      })
      .catch((error: unknown) => {
        if (error instanceof CommandError) return null;
        throw error;
      });

    return recorded ? returnTo(recorded) : failurePage(handle);
  };
}
