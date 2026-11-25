// Product analytics (web-analytics change), with PostHog in Vercel production
// only and only when a project key is set (design D3). Events reach PostHog
// through the app's own /ingest rewrite (design D5), so the Content Security
// Policy stays on the app's origin. next.config.ts repeats the gate and the
// region hosts to add that rewrite exactly when the root layout loads the
// client; its loader cannot import this module, so analytics.test.ts checks that
// the two agree.

type Environment = Readonly<Record<string, string | undefined>>;

const PROJECT_KEY = /^phc_[A-Za-z0-9]+$/;

export type AnalyticsRegion = "us" | "eu";

export type AnalyticsConfig = {
  readonly key: string;
  readonly region: AnalyticsRegion;
};

// The path the browser sends events to; next.config.ts rewrites it to PostHog.
export const ANALYTICS_INGEST_PATH = "/ingest";

// PostHog's hosts for a cloud region: events, the SDK's lazily loaded scripts,
// and the app that links back to recordings.
export function analyticsHosts(region: AnalyticsRegion) {
  return {
    api: `https://${region}.i.posthog.com`,
    assets: `https://${region}-assets.i.posthog.com`,
    ui: `https://${region}.posthog.com`,
  } as const;
}

// The project key and region to load, or undefined when analytics stays off.
// Production is read as lib/server/deployment.ts reads it (VERCEL=1 and
// VERCEL_ENV=production), without its custom-target checks, which next.config.ts
// cannot import. The region defaults to the US cloud.
export function analyticsConfig(env: Environment = process.env): AnalyticsConfig | undefined {
  const key = env.POSTHOG_PROJECT_KEY?.trim();
  const region = env.POSTHOG_REGION?.trim() || "us";

  if (!key || !PROJECT_KEY.test(key) || (region !== "us" && region !== "eu")) {
    return undefined;
  }

  return env.VERCEL?.trim() === "1" && env.VERCEL_ENV?.trim() === "production" ? { key, region } : undefined;
}

// The path analytics receives (design D2). `/` and single-segment paths are public
// (`/app`, `/privacy`, a host's handle); a longer path can hold a booking
// identifier, a link code or an OAuth step, so only its first segment is kept.
export function analyticsPath(pathname: string): string {
  const segments = pathname.split(/[?#]/, 1)[0].split("/").filter(Boolean);

  if (segments.length === 0) {
    return "/";
  }

  return segments.length === 1 ? `/${segments[0]}` : `/${segments[0]}/[redacted]`;
}

// A referrer reduced to its origin, so a credential path never reaches analytics.
export function analyticsReferrer(referrer: string): string {
  return URL.canParse(referrer) ? new URL(referrer).origin : "";
}

// An address on this origin with its path redacted and its query and fragment
// dropped; an address elsewhere reduced to its origin; a bare path redacted.
// Anything else is returned as it is.
export function analyticsUrl(value: string, origin: string): string {
  if (value.startsWith("/") && !value.startsWith("//")) {
    const pathname = value.split(/[?#]/, 1)[0];
    return analyticsAssetPath(pathname) ?? analyticsPath(pathname);
  }

  if (!URL.canParse(value)) {
    return value;
  }

  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return value;
  }

  if (url.origin !== origin) {
    return url.origin;
  }

  return `${url.origin}${analyticsAssetPath(url.pathname) ?? analyticsPath(url.pathname)}`;
}

// A built asset (`/_next/...`) holds no credential, and a recording needs its
// address to replay the page's styles, so it is kept, still without its query.
// Nothing else is: a connect-link token and an email address look like file
// names. Public files sit at a single segment, which analyticsPath keeps anyway.
function analyticsAssetPath(pathname: string) {
  return pathname.startsWith("/_next/") ? pathname : undefined;
}

// The first segments of the app's paths that carry a credential or a resource ID
// one segment deeper; text naming such a path is redacted wherever it appears.
const CREDENTIAL_PATH = /\/(api|auth|booking|connect|connections|imessage|oauth)\/[^\s"'<>()`]+/g;

// Free text, such as an error message or a stack frame's file, with every address
// on this origin and every credential path redacted in place.
export function analyticsText(value: string, origin: string): string {
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value
    .replace(new RegExp(`${escaped}(/[^\\s"'<>()\`]*)?`, "g"), (address) => analyticsUrl(address, origin))
    .replace(CREDENTIAL_PATH, (path, _first, offset: number, whole: string) =>
      // Already redacted as part of an address above.
      whole.slice(Math.max(0, offset - origin.length), offset) === origin ? path : analyticsPath(path),
    );
}

// Property names whose values are addresses or paths (PostHog's $current_url,
// $pathname, $referrer and their $initial_, $session_entry_ and $prev_ forms,
// replay's href, autocapture's attr__href and the like).
const ADDRESS_KEY = /(url|pathname|referrer|href|src|action|location)$/i;
// An href, src or action attribute inside an autocapture element chain.
const CHAIN_ADDRESS = /(attr__(?:href|src|action)=")([^"]*)(")/g;

// Redacts every address inside an event before it leaves the browser (design D2):
// properties, $set and $set_once, element chains, heatmap keys (which are
// addresses) and session replay snapshots (whose meta events carry the page's
// href). Returns a copy; the input is never changed.
export function redactAnalyticsValue(value: unknown, origin: string, key = ""): unknown {
  if (typeof value === "string") {
    if (key === "$elements_chain") {
      return value.replace(CHAIN_ADDRESS, (_match, start: string, address: string, end: string) => `${start}${analyticsUrl(address, origin)}${end}`);
    }
    return ADDRESS_KEY.test(key) ? analyticsUrl(value, origin) : analyticsText(value, origin);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactAnalyticsValue(entry, origin, key));
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        // Heatmap data is keyed by the page's address.
        URL.canParse(name) ? analyticsUrl(name, origin) : name,
        redactAnalyticsValue(entry, origin, name),
      ]),
    );
  }

  return value;
}
