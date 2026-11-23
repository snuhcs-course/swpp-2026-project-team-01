// Page-view analytics (web-analytics change). Google Analytics 4 through gtag.js,
// in Vercel production only and only when a measurement ID is set (design D3).
// next.config.ts repeats the gate and the origins below to widen the Content
// Security Policy exactly when the root layout loads the tag (its loader cannot
// import this module); analytics.test.ts checks that the two agree.

type Environment = Readonly<Record<string, string | undefined>>;

const MEASUREMENT_ID = /^G-[A-Z0-9]+$/;

// The measurement ID to load, or undefined when analytics stays off. Production
// is read as lib/server/deployment.ts reads it (VERCEL=1 and VERCEL_ENV=production),
// without its custom-target checks, which next.config.ts cannot import.
export function analyticsMeasurementId(env: Environment = process.env): string | undefined {
  const id = env.GOOGLE_ANALYTICS_MEASUREMENT_ID?.trim();

  if (!id || !MEASUREMENT_ID.test(id)) {
    return undefined;
  }

  return env.VERCEL?.trim() === "1" && env.VERCEL_ENV?.trim() === "production" ? id : undefined;
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

// Google's GA4 origins for the Content Security Policy, from Google's guidance for
// gtag.js without Google Signals.
export const analyticsContentSecuritySources = {
  connect: ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://www.googletagmanager.com"],
  img: ["https://*.google-analytics.com", "https://www.googletagmanager.com"],
  script: ["https://www.googletagmanager.com"],
} as const;
