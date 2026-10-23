import type { NextConfig } from "next";

const development = process.env.NODE_ENV === "development";

// A static policy: Next.js inlines its bootstrap scripts, and a per-request nonce
// would make every page dynamic, so scripts are limited to this origin plus
// inline. Shiki's highlighter compiles WebAssembly. Development adds eval and the
// hot-reload socket.
export const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${development ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${development ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// The consent page's form posts to /connect/decision, which redirects to the
// agent's own callback: an https URL or a loopback http one, checked against
// the client's registration on the server (agent-access design 7). Chrome
// applies form-action to that redirect, so this page widens it to those schemes.
export const consentContentSecurityPolicy = contentSecurityPolicy.replace("form-action 'self'", "form-action 'self' https: http:");

// The requester's Continue with Google and Connect Google Calendar post to
// /connections/google/start, which redirects to Google's consent screen; Chrome
// applies form-action to that redirect, so the requester's pages allow Google's
// origin. Outside production the consent screen may be a local stand-in
// (GOOGLE_REQUESTER_AUTH_URL), as lib/server/requester-google.ts allows. The
// config loader cannot import lib/server/deployment.ts, so any VERCEL_ENV of
// production counts as production here, a stricter reading than that module's.
const requesterAuthOverride = process.env.VERCEL_ENV?.trim() !== "production" ? process.env.GOOGLE_REQUESTER_AUTH_URL?.trim() : undefined;
const requesterConsentOrigins = [
  "https://accounts.google.com",
  ...(requesterAuthOverride && URL.canParse(requesterAuthOverride) ? [new URL(requesterAuthOverride).origin] : []),
];
export const requesterContentSecurityPolicy = contentSecurityPolicy.replace(
  "form-action 'self'",
  `form-action 'self' ${requesterConsentOrigins.join(" ")}`,
);

export const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  agentRules: false,
  cacheComponents: true,
  async headers() {
    // `/` and the single-segment host pages negotiate Markdown in the proxy, so
    // their HTML varies by Accept too (dotted paths are files, not handles).
    const varyByAccept = [{ key: "Vary", value: "Accept" }];
    // Booking and confirmation identifiers in the path are credentials: never
    // sent as a referrer, indexed or cached. Later entries win for the same key.
    const credentialPath = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex" },
      { key: "Cache-Control", value: "no-store" },
    ];

    return [
      { headers: securityHeaders, source: "/:path*" },
      { headers: credentialPath, source: "/booking/:path*" },
      { headers: credentialPath, source: "/api/requests/:path*" },
      { headers: credentialPath, source: "/api/booking-links/:path*" },
      { headers: credentialPath, source: "/api/contact-confirmations" },
      // The requester's Google return can redirect to a booking link.
      { headers: credentialPath, source: "/connections/:path*" },
      { headers: [{ key: "Content-Security-Policy", value: consentContentSecurityPolicy }], source: "/connect/consent" },
      { headers: [{ key: "Content-Security-Policy", value: requesterContentSecurityPolicy }], source: "/:handle([^/.]+)" },
      { headers: [{ key: "Content-Security-Policy", value: requesterContentSecurityPolicy }], source: "/booking/:path*" },
      // The booking page posts Connect Google Calendar as a form, which Chrome
      // sends with `Origin: null` under no-referrer; same-origin keeps the link
      // inside the origin (see apps/web/app/booking/[bookingId]/page.tsx).
      { headers: [{ key: "Referrer-Policy", value: "same-origin" }], source: "/booking/:bookingId([^/]+)" },
      { headers: varyByAccept, source: "/" },
      { headers: varyByAccept, source: "/:handle([^/.]+)" },
    ];
  },
};

export default nextConfig;
