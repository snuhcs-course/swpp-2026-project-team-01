import { parseCookieHeader } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { GOOGLE_CALENDAR_SCOPES } from "../contracts/google-scopes";
import { isLiveHostTransaction } from "./agent-authorize";
import { type Database, database } from "./database";
import { createGrantedScopesFetcher, type FetchGrantedScopes } from "./google-token-info";
import { ensureHostAccount, type HostAccount } from "./host-accounts";
import { recordGoogleGrant } from "./provider-grants";
import { type AppOrigins, appOriginsFromEnvironment, crossSiteRefusal, requestAppOrigin, unknownHost } from "./same-origin";
import { admitSignUp, SIGNUP_LIMITS, SignUpLimitError, type SignUpLimits, sourceHash } from "./signup-limits";
import { createRequestAuthClient, type SupabaseAuthConfig, supabaseAuthConfigFromEnvironment } from "./supabase-auth";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Each route answers for the listed origin the request was addressed to, so
// findmeatime.com and a release host sign in, return and set cookies on their own.
export type GoogleSignInDependencies = AppOrigins & {
  readonly auth: SupabaseAuthConfig;
  readonly db: Database;
  readonly fetchGrantedScopes: FetchGrantedScopes;
  // The sign-up bounds; production uses SIGNUP_LIMITS.
  readonly signUpLimits: SignUpLimits;
  readonly tokenKey: TokenKey;
};

export type GoogleSignInResult = {
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly user: User;
};

function dependenciesFromEnvironment(): GoogleSignInDependencies {
  return {
    ...appOriginsFromEnvironment(),
    auth: supabaseAuthConfigFromEnvironment(),
    db: database(),
    fetchGrantedScopes: createGrantedScopesFetcher(),
    signUpLimits: SIGNUP_LIMITS,
    tokenKey: tokenKeyFromEnvironment(),
  };
}

function googleIdentity(user: User) {
  const identity = user.identities?.find((candidate) => candidate.provider === "google");
  const subject = identity?.identity_data?.sub ?? identity?.id;
  const email = user.email ?? identity?.identity_data?.email;

  if (typeof subject !== "string" || !subject || typeof email !== "string") {
    throw new Error("The signed-in user has no Google identity.");
  }

  return { authUserId: user.id, email, googleSubject: subject };
}

// The Google profile name, as Auth stores it in the user metadata, reduced to
// printable text that fits host_accounts.display_name; null when there is none.
function profileName(user: User) {
  const raw = user.user_metadata?.full_name ?? user.user_metadata?.name;

  if (typeof raw !== "string") return null;

  // oxlint-disable-next-line no-control-regex -- removing control characters is the point
  const name = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 200).trim();
  return name || null;
}

// Reads the granted scopes before the transaction, then creates or returns the
// host account and records the Calendar grant in one transaction. Creating an
// account first admits the sign-up for its source (the keyed source hash), which
// throws SignUpLimitError past a bound. An active account's display name follows
// the Google profile; a suspended account is returned unchanged.
export async function completeGoogleSignIn(
  deps: Pick<GoogleSignInDependencies, "db" | "fetchGrantedScopes" | "signUpLimits" | "tokenKey">,
  signIn: GoogleSignInResult,
  source: string,
): Promise<HostAccount> {
  const identity = googleIdentity(signIn.user);
  const displayName = profileName(signIn.user);
  const grantedScopes = signIn.accessToken ? await deps.fetchGrantedScopes(signIn.accessToken) : null;

  return (await deps.db.begin(async (tx) => {
    const account = await ensureHostAccount(tx, identity, (lockedTx) => admitSignUp(lockedTx, source, deps.signUpLimits));

    if (account.status === "active") {
      if (displayName) {
        await tx`
          update app.host_accounts set display_name = ${displayName}, updated_at = now()
          where id = ${account.id} and display_name is distinct from ${displayName}
        `;
      }

      await recordGoogleGrant(tx, deps.tokenKey, {
        grantedScopes,
        hostAccountId: account.id,
        refreshToken: signIn.refreshToken,
      });
    }

    return account;
  })) as HostAccount;
}

// The sign-in return to an agent consent transaction (agent-access D7). Sign-in
// started from /connect/consent with `return=consent&transaction={id}` records
// the transaction in this HttpOnly cookie, scoped to /auth, after checking that
// it is a live, undecided host transaction; the callback clears it, checks the
// transaction again and returns there, otherwise to /app. No query parameter
// ever chooses the destination.
export const RETURN_COOKIE = "fmat_auth_return";
const RETURN_SECONDS = 10 * 60;

function returnCookie(value: string, origin: string, maxAge: number) {
  const secure = origin.startsWith("https:") ? "; Secure" : "";
  return `${RETURN_COOKIE}=${value}; Path=/auth; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function recordedReturn(request: Request) {
  return parseCookieHeader(request.headers.get("cookie") ?? "").find((cookie) => cookie.name === RETURN_COOKIE)?.value ?? null;
}

// GET /auth/sign-in: one Google consent for identity and the Calendar scopes,
// with PKCE (the verifier stays in this browser's cookie) and offline access.
// `?consent=calendar` (Connect Google Calendar) asks Google to show the consent
// screen again and keep earlier grants, so declined Calendar scopes can be granted
// and a fresh refresh token comes back; any other value is ignored.
export function createGoogleSignInHandler(load: () => GoogleSignInDependencies = dependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const origin = requestAppOrigin(request, deps);

    if (!origin) return unknownHost();

    const params = new URL(request.url).searchParams;
    const renewConsent = params.get("consent") === "calendar";
    const transaction = params.get("return") === "consent" ? params.get("transaction") : null;
    const consentReturn = transaction && (await isLiveHostTransaction(deps.db, transaction)) ? transaction : null;
    const auth = createRequestAuthClient(request, deps.auth);
    const { data, error } = await auth.client.auth.signInWithOAuth({
      options: {
        queryParams: {
          access_type: "offline",
          ...(renewConsent ? { include_granted_scopes: "true", prompt: "consent" } : {}),
        },
        redirectTo: `${origin}/auth/callback`,
        scopes: GOOGLE_CALENDAR_SCOPES.join(" "),
        skipBrowserRedirect: true,
      },
      provider: "google",
    });

    if (error || !data.url) {
      return auth.redirect(`${origin}/app?sign_in=failed`);
    }

    return auth.redirect(data.url, [returnCookie(consentReturn ?? "", origin, consentReturn ? RETURN_SECONDS : 0)]);
  };
}

// GET /auth/callback: returns to /app, or to the live agent consent transaction
// sign-in recorded (D7), and never reads a caller-supplied destination. A
// cancelled, replayed or other-browser return establishes no session, and
// neither does a new identity past a sign-up bound (`?sign_in=limited`).
export function createGoogleCallbackHandler(load: () => GoogleSignInDependencies = dependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const origin = requestAppOrigin(request, deps);

    if (!origin) return unknownHost();

    const auth = createRequestAuthClient(request, deps.auth);
    const failed = `${origin}/app?sign_in=failed`;
    const code = new URL(request.url).searchParams.get("code");
    const recorded = recordedReturn(request);
    const clear = recorded === null ? [] : [returnCookie("", origin, 0)];

    if (!code) {
      return auth.redirect(failed, clear);
    }

    const { data, error } = await auth.client.auth.exchangeCodeForSession(code);

    if (error || !data.session) {
      return auth.redirect(failed, clear);
    }

    try {
      await completeGoogleSignIn(
        deps,
        {
          accessToken: data.session.provider_token ?? null,
          refreshToken: data.session.provider_refresh_token ?? null,
          user: data.user,
        },
        sourceHash(deps.tokenKey, request),
      );
    } catch (caught) {
      await auth.client.auth.signOut();
      return auth.redirect(caught instanceof SignUpLimitError ? `${origin}/app?sign_in=limited` : failed, clear);
    }

    const consent = recorded && (await isLiveHostTransaction(deps.db, recorded)) ? `${origin}/connect/consent?transaction=${recorded}` : null;
    return auth.redirect(consent ?? `${origin}/app`, clear);
  };
}

// POST /auth/sign-out: ends the Supabase session and its cookies, then returns to
// the public page.
export function createSignOutHandler(load: () => GoogleSignInDependencies = dependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: false });

    if (refused) return refused;

    const auth = createRequestAuthClient(request, deps.auth);
    await auth.client.auth.signOut();
    return auth.redirect(`${requestAppOrigin(request, deps)}/`);
  };
}
