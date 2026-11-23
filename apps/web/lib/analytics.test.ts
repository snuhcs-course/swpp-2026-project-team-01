import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsContentSecuritySources, analyticsMeasurementId, analyticsPath, analyticsReferrer } from "./analytics";

async function policyWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  return (await import("../next.config")).contentSecurityPolicy;
}

function directive(policy: string, name: string) {
  return policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";
}

describe("Content Security Policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows Google's origins exactly when the layout loads the tag", async () => {
    const env = { GOOGLE_ANALYTICS_MEASUREMENT_ID: "G-ABC123XYZ", VERCEL: "1", VERCEL_ENV: "production" };
    expect(analyticsMeasurementId(env)).toBeDefined();
    const policy = await policyWith(env);

    for (const source of analyticsContentSecuritySources.script) expect(directive(policy, "script-src")).toContain(source);
    for (const source of analyticsContentSecuritySources.connect) expect(directive(policy, "connect-src")).toContain(source);
    for (const source of analyticsContentSecuritySources.img) expect(directive(policy, "img-src")).toContain(source);
  });

  it("stays on the app's own origin otherwise", async () => {
    for (const env of [
      { GOOGLE_ANALYTICS_MEASUREMENT_ID: "G-ABC123XYZ", VERCEL: "1", VERCEL_ENV: "preview" },
      { GOOGLE_ANALYTICS_MEASUREMENT_ID: "", VERCEL: "1", VERCEL_ENV: "production" },
      { GOOGLE_ANALYTICS_MEASUREMENT_ID: "UA-1234-1", VERCEL: "1", VERCEL_ENV: "production" },
    ]) {
      expect(analyticsMeasurementId(env)).toBeUndefined();
      expect(await policyWith(env)).not.toContain("google");
      vi.unstubAllEnvs();
    }
  });
});

const production = { GOOGLE_ANALYTICS_MEASUREMENT_ID: "G-ABC123XYZ", VERCEL: "1", VERCEL_ENV: "production" };

describe("analyticsMeasurementId", () => {
  it("returns the ID on Vercel production", () => {
    expect(analyticsMeasurementId(production)).toBe("G-ABC123XYZ");
    expect(analyticsMeasurementId({ ...production, GOOGLE_ANALYTICS_MEASUREMENT_ID: " G-ABC123XYZ " })).toBe("G-ABC123XYZ");
  });

  it("stays off outside production", () => {
    expect(analyticsMeasurementId({ GOOGLE_ANALYTICS_MEASUREMENT_ID: "G-ABC123XYZ" })).toBeUndefined();
    expect(analyticsMeasurementId({ ...production, VERCEL_ENV: "preview" })).toBeUndefined();
    expect(analyticsMeasurementId({ ...production, VERCEL_ENV: "development" })).toBeUndefined();
    expect(analyticsMeasurementId({ ...production, VERCEL: undefined })).toBeUndefined();
  });

  it("stays off without a valid GA4 measurement ID", () => {
    expect(analyticsMeasurementId({ ...production, GOOGLE_ANALYTICS_MEASUREMENT_ID: undefined })).toBeUndefined();
    expect(analyticsMeasurementId({ ...production, GOOGLE_ANALYTICS_MEASUREMENT_ID: "" })).toBeUndefined();
    expect(analyticsMeasurementId({ ...production, GOOGLE_ANALYTICS_MEASUREMENT_ID: "UA-1234-1" })).toBeUndefined();
    expect(analyticsMeasurementId({ ...production, GOOGLE_ANALYTICS_MEASUREMENT_ID: 'G-1"><script>' })).toBeUndefined();
  });
});

describe("analyticsPath", () => {
  it("keeps the root and single-segment public pages", () => {
    expect(analyticsPath("/")).toBe("/");
    expect(analyticsPath("")).toBe("/");
    expect(analyticsPath("/app")).toBe("/app");
    expect(analyticsPath("/privacy")).toBe("/privacy");
    expect(analyticsPath("/terms-of-service")).toBe("/terms-of-service");
    expect(analyticsPath("/some-host")).toBe("/some-host");
    expect(analyticsPath("/some-host/")).toBe("/some-host");
  });

  it("redacts every path that can carry a credential", () => {
    expect(analyticsPath("/booking/2f1d9c1e-7c3a-4b8e-9a51-0d6c5f3e2a10")).toBe("/booking/[redacted]");
    expect(analyticsPath("/connect/link/ABCD-1234")).toBe("/connect/[redacted]");
    expect(analyticsPath("/connect/consent")).toBe("/connect/[redacted]");
    expect(analyticsPath("/connections/google/callback")).toBe("/connections/[redacted]");
    expect(analyticsPath("/imessage/continue")).toBe("/imessage/[redacted]");
    expect(analyticsPath("/auth/callback")).toBe("/auth/[redacted]");
    expect(analyticsPath("/oauth/authorize")).toBe("/oauth/[redacted]");
  });

  it("drops query strings and fragments", () => {
    expect(analyticsPath("/some-host?lang=ko")).toBe("/some-host");
    expect(analyticsPath("/app#settings")).toBe("/app");
    expect(analyticsPath("/auth/callback?code=secret")).toBe("/auth/[redacted]");
  });
});

describe("analyticsReferrer", () => {
  it("keeps only the origin", () => {
    expect(analyticsReferrer("https://findmeatime.com/booking/2f1d9c1e?x=1")).toBe("https://findmeatime.com");
    expect(analyticsReferrer("https://www.google.com/search?q=find+me+a+time")).toBe("https://www.google.com");
  });

  it("is empty without a referrer", () => {
    expect(analyticsReferrer("")).toBe("");
    expect(analyticsReferrer("not a url")).toBe("");
  });
});
