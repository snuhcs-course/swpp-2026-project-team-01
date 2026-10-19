// Supabase Auth does not pass through the scopes Google granted, and the consent
// screen lets the user uncheck Calendar access. The granted scopes are read from
// Google's token information endpoint with the provider access token. Any failure
// returns null, so the caller records no Calendar grant.

export const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";

export type FetchGrantedScopes = (accessToken: string) => Promise<string[] | null>;

export function createGrantedScopesFetcher(
  endpoint = GOOGLE_TOKEN_INFO_URL,
  timeoutMs = 5_000,
): FetchGrantedScopes {
  return async (accessToken) => {
    try {
      // POST keeps the token out of request URLs and their logs.
      const response = await fetch(endpoint, {
        body: new URLSearchParams({ access_token: accessToken }),
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        return null;
      }

      const body: unknown = await response.json();
      const scope =
        typeof body === "object" && body !== null && "scope" in body ? body.scope : undefined;

      return typeof scope === "string" ? scope.split(" ").filter(Boolean) : null;
    } catch {
      return null;
    }
  };
}
