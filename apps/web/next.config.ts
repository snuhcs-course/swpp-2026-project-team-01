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
      { headers: varyByAccept, source: "/" },
      { headers: varyByAccept, source: "/:handle([^/.]+)" },
    ];
  },
};

export default nextConfig;
