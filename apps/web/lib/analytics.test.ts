import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsConfig, analyticsHosts, analyticsPath, analyticsReferrer, analyticsText, analyticsUrl, redactAnalyticsValue } from "./analytics";

const production = { POSTHOG_PROJECT_KEY: "phc_AbC123xyz", VERCEL: "1", VERCEL_ENV: "production" };
const origin = "https://findmeatime.com";

async function configWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  return import("../next.config");
}

describe("next.config analytics relay", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rewrites /ingest to the region's hosts exactly when the layout loads the client", async () => {
    for (const env of [production, { ...production, POSTHOG_REGION: "eu" }]) {
      const config = analyticsConfig(env);
      expect(config).toBeDefined();
      const hosts = analyticsHosts(config!.region);
      const { analyticsRedirects, analyticsRewrites, default: nextConfig } = await configWith(env);

      expect(analyticsRewrites).toEqual([
        { destination: `${hosts.assets}/static/:path*`, source: "/ingest/static/:path*" },
        { destination: `${hosts.assets}/array/:path*`, source: "/ingest/array/:path*" },
        { destination: `${hosts.api}/:path*`, source: "/ingest/:path*" },
      ]);
      expect(nextConfig.skipTrailingSlashRedirect).toBe(true);
      expect(analyticsRedirects).toHaveLength(1);
      vi.unstubAllEnvs();
    }
  });

  it("adds nothing otherwise, and the policy never names PostHog or Google", async () => {
    for (const env of [
      { ...production, VERCEL_ENV: "preview" },
      { ...production, POSTHOG_PROJECT_KEY: "" },
      { ...production, POSTHOG_PROJECT_KEY: "phx_personal" },
      { ...production, POSTHOG_REGION: "ap" },
    ]) {
      expect(analyticsConfig(env)).toBeUndefined();
      const { analyticsRedirects, analyticsRewrites, contentSecurityPolicy, default: nextConfig } = await configWith(env);
      expect(analyticsRewrites).toEqual([]);
      expect(analyticsRedirects).toEqual([]);
      expect(nextConfig.skipTrailingSlashRedirect).toBe(false);
      expect(contentSecurityPolicy).not.toMatch(/posthog|google/);
      vi.unstubAllEnvs();
    }
  });
});

describe("analyticsConfig", () => {
  it("returns the key and region on Vercel production", () => {
    expect(analyticsConfig(production)).toEqual({ key: "phc_AbC123xyz", region: "us" });
    expect(analyticsConfig({ ...production, POSTHOG_PROJECT_KEY: " phc_AbC123xyz ", POSTHOG_REGION: "eu" })).toEqual({ key: "phc_AbC123xyz", region: "eu" });
  });

  it("stays off outside production", () => {
    expect(analyticsConfig({ POSTHOG_PROJECT_KEY: "phc_AbC123xyz" })).toBeUndefined();
    expect(analyticsConfig({ ...production, VERCEL_ENV: "preview" })).toBeUndefined();
    expect(analyticsConfig({ ...production, VERCEL_ENV: "development" })).toBeUndefined();
    expect(analyticsConfig({ ...production, VERCEL: undefined })).toBeUndefined();
  });

  it("stays off without a project key", () => {
    expect(analyticsConfig({ ...production, POSTHOG_PROJECT_KEY: undefined })).toBeUndefined();
    expect(analyticsConfig({ ...production, POSTHOG_PROJECT_KEY: "phx_personal_api_key" })).toBeUndefined();
    expect(analyticsConfig({ ...production, POSTHOG_PROJECT_KEY: 'phc_1"><script>' })).toBeUndefined();
  });
});

describe("analyticsPath", () => {
  it("keeps the root and single-segment public pages", () => {
    expect(analyticsPath("/")).toBe("/");
    expect(analyticsPath("")).toBe("/");
    expect(analyticsPath("/app")).toBe("/app");
    expect(analyticsPath("/privacy")).toBe("/privacy");
    expect(analyticsPath("/some-host")).toBe("/some-host");
    expect(analyticsPath("/some-host/")).toBe("/some-host");
  });

  it("redacts every path that can carry a credential", () => {
    expect(analyticsPath("/booking/2f1d9c1e-7c3a-4b8e-9a51-0d6c5f3e2a10")).toBe("/booking/[redacted]");
    expect(analyticsPath("/connect/link/ABCD-1234")).toBe("/connect/[redacted]");
    expect(analyticsPath("/connections/google/callback")).toBe("/connections/[redacted]");
    expect(analyticsPath("/imessage/continue")).toBe("/imessage/[redacted]");
    expect(analyticsPath("/auth/callback")).toBe("/auth/[redacted]");
    expect(analyticsPath("/oauth/authorize")).toBe("/oauth/[redacted]");
    expect(analyticsPath("/api/requests/2f1d9c1e/events")).toBe("/api/[redacted]");
  });

  it("drops query strings and fragments", () => {
    expect(analyticsPath("/some-host?lang=ko")).toBe("/some-host");
    expect(analyticsPath("/auth/callback?code=secret")).toBe("/auth/[redacted]");
  });
});

describe("analyticsUrl", () => {
  it("redacts addresses on this origin and reduces others to their origin", () => {
    expect(analyticsUrl(`${origin}/booking/2f1d9c1e?ref=mail#top`, origin)).toBe(`${origin}/booking/[redacted]`);
    expect(analyticsUrl(`${origin}/some-host?lang=ko`, origin)).toBe(`${origin}/some-host`);
    expect(analyticsUrl("https://www.google.com/search?q=find+me+a+time", origin)).toBe("https://www.google.com");
    expect(analyticsUrl("/connect/link/ABCD-1234", origin)).toBe("/connect/[redacted]");
  });

  it("keeps built assets and public files, without their query", () => {
    expect(analyticsUrl(`${origin}/_next/static/css/app.css?v=1`, origin)).toBe(`${origin}/_next/static/css/app.css`);
    expect(analyticsUrl("/icon.svg", origin)).toBe("/icon.svg");
  });

  it("redacts deep paths that look like file names", () => {
    // A connect-link token is dotted base64url; an email address ends in a domain.
    expect(analyticsUrl(`${origin}/connect/link/k1.v1.Zm9v.YmFy.YmF6`, origin)).toBe(`${origin}/connect/[redacted]`);
    expect(analyticsUrl("/booking/guest@example.com", origin)).toBe("/booking/[redacted]");
    expect(analyticsUrl("/some-host/SKILL.md", origin)).toBe("/some-host/[redacted]");
  });

  it("leaves other values alone", () => {
    expect(analyticsUrl("Book a meeting", origin)).toBe("Book a meeting");
    expect(analyticsUrl("mailto:host@example.com", origin)).toBe("mailto:host@example.com");
  });
});

describe("analyticsText", () => {
  it("redacts addresses and credential paths inside free text", () => {
    expect(analyticsText(`Failed to fetch ${origin}/api/requests/2f1d9c1e/events?x=1: 500`, origin)).toBe(`Failed to fetch ${origin}/api/[redacted] 500`);
    expect(analyticsText("POST /booking/2f1d9c1e/accept failed", origin)).toBe("POST /booking/[redacted] failed");
    expect(analyticsText(`at ${origin}/connect/link/k1.v1.Zm9v.YmFy:12:4`, origin)).not.toContain("Zm9v");
    expect(analyticsText(`at ${origin}/_next/static/chunks/main.js:1:2`, origin)).toBe(`at ${origin}/_next/static/chunks/main.js:1:2`);
    expect(analyticsText("Book a meeting", origin)).toBe("Book a meeting");
  });
});

describe("analyticsReferrer", () => {
  it("keeps only the origin", () => {
    expect(analyticsReferrer("https://findmeatime.com/booking/2f1d9c1e?x=1")).toBe("https://findmeatime.com");
    expect(analyticsReferrer("")).toBe("");
    expect(analyticsReferrer("not a url")).toBe("");
  });
});

describe("redactAnalyticsValue", () => {
  const booking = `${origin}/booking/2f1d9c1e-7c3a-4b8e-9a51-0d6c5f3e2a10?ref=mail`;

  it("redacts PostHog's address properties, $set and $set_once", () => {
    const event = {
      event: "$pageview",
      properties: {
        $current_url: booking,
        $pathname: "/booking/2f1d9c1e-7c3a-4b8e-9a51-0d6c5f3e2a10",
        $referrer: "https://mail.example.com/inbox/123",
        $session_entry_url: booking,
        $prev_pageview_pathname: "/connect/link/ABCD-1234",
        $utm_source: "newsletter",
        $browser: "Chrome",
      },
      $set: { $current_url: booking },
      $set_once: { $initial_current_url: booking, $initial_referrer: "https://mail.example.com/inbox/123" },
    };

    expect(redactAnalyticsValue(event, origin)).toEqual({
      event: "$pageview",
      properties: {
        $current_url: `${origin}/booking/[redacted]`,
        $pathname: "/booking/[redacted]",
        $referrer: "https://mail.example.com",
        $session_entry_url: `${origin}/booking/[redacted]`,
        $prev_pageview_pathname: "/connect/[redacted]",
        $utm_source: "newsletter",
        $browser: "Chrome",
      },
      $set: { $current_url: `${origin}/booking/[redacted]` },
      $set_once: { $initial_current_url: `${origin}/booking/[redacted]`, $initial_referrer: "https://mail.example.com" },
    });
    expect(JSON.stringify(redactAnalyticsValue(event, origin))).not.toContain("2f1d9c1e");
  });

  it("redacts links in autocapture element chains and elements", () => {
    const chain = 'a.card:attr__href="/booking/2f1d9c1e"nth-child="1";div:attr__class="list"';
    expect(redactAnalyticsValue({ $elements_chain: chain, $elements: [{ attr__href: "/booking/2f1d9c1e", tag_name: "a" }] }, origin)).toEqual({
      $elements_chain: 'a.card:attr__href="/booking/[redacted]"nth-child="1";div:attr__class="list"',
      $elements: [{ attr__href: "/booking/[redacted]", tag_name: "a" }],
    });
  });

  it("redacts heatmap keys and replay snapshots", () => {
    const heatmap = { $heatmap_data: { [booking]: [{ x: 1, y: 2 }] } };
    expect(redactAnalyticsValue(heatmap, origin)).toEqual({ $heatmap_data: { [`${origin}/booking/[redacted]`]: [{ x: 1, y: 2 }] } });

    const snapshot = {
      $snapshot_data: [
        { data: { height: 800, href: booking, width: 1200 }, type: 4 },
        { data: { node: { attributes: { href: "/booking/2f1d9c1e", rel: "next" }, tagName: "a" } }, type: 2 },
        { data: { node: { attributes: { href: "/_next/static/css/app.css", rel: "stylesheet" }, tagName: "link" } }, type: 2 },
      ],
    };
    expect(redactAnalyticsValue(snapshot, origin)).toEqual({
      $snapshot_data: [
        { data: { height: 800, href: `${origin}/booking/[redacted]`, width: 1200 }, type: 4 },
        { data: { node: { attributes: { href: "/booking/[redacted]", rel: "next" }, tagName: "a" } }, type: 2 },
        { data: { node: { attributes: { href: "/_next/static/css/app.css", rel: "stylesheet" }, tagName: "link" } }, type: 2 },
      ],
    });
  });

  it("redacts exception messages and stack frames, whatever their keys", () => {
    const exception = {
      $exception_list: [
        {
          stacktrace: { frames: [{ abs_path: `${origin}/booking/2f1d9c1e?x=1`, filename: `${origin}/booking/2f1d9c1e`, lineno: 3 }] },
          value: "Request /api/requests/2f1d9c1e failed",
        },
      ],
    };
    expect(JSON.stringify(redactAnalyticsValue(exception, origin))).not.toContain("2f1d9c1e");
  });

  it("returns a copy", () => {
    const event = { properties: { $current_url: booking } };
    redactAnalyticsValue(event, origin);
    expect(event.properties.$current_url).toBe(booking);
  });
});
