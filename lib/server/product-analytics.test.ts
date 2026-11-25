import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsMessage, anonymousAnalyticsId, type AnalyticsSink, captureServerEvent, serverAnalyticsConfig, setAnalyticsSinkForTests } from "./product-analytics";

const production = { POSTHOG_PROJECT_KEY: "phc_AbC123xyz", VERCEL: "1", VERCEL_ENV: "production" };

describe("serverAnalyticsConfig", () => {
  it("sends only from Vercel production with a project key", () => {
    expect(serverAnalyticsConfig(production)).toEqual({ host: "https://us.i.posthog.com", key: "phc_AbC123xyz" });
    expect(serverAnalyticsConfig({ ...production, POSTHOG_REGION: "eu" })).toEqual({ host: "https://eu.i.posthog.com", key: "phc_AbC123xyz" });
    expect(serverAnalyticsConfig({ ...production, VERCEL_ENV: "preview" })).toBeNull();
    expect(serverAnalyticsConfig({ ...production, VERCEL_TARGET_ENV: "staging" })).toBeNull();
    expect(serverAnalyticsConfig({ POSTHOG_PROJECT_KEY: "phc_AbC123xyz" })).toBeNull();
    expect(serverAnalyticsConfig({ ...production, POSTHOG_PROJECT_KEY: "phx_personal" })).toBeNull();
    expect(serverAnalyticsConfig({ ...production, POSTHOG_REGION: "ap" })).toBeNull();
  });
});

describe("analyticsMessage", () => {
  it("identifies a host by their account and gives them a profile", () => {
    expect(analyticsMessage({ event: "request.approve", properties: { actor_kind: "host_account" }, subject: { hostAccountId: "host-1", kind: "host" } }, production)).toEqual({
      distinctId: "host-1",
      event: "request.approve",
      properties: { $process_person_profile: true, actor_kind: "host_account", deployment: "production", source: "server" },
    });
  });

  it("gives anyone else a stable pseudonym and no profile", () => {
    const message = analyticsMessage({ event: "booking.cancel", subject: { id: "request-1", kind: "anonymous", scope: "request" } }, production);
    expect(message.distinctId).toBe(anonymousAnalyticsId("request", "request-1"));
    expect(message.distinctId).toMatch(/^request:[0-9a-f]{20}$/);
    expect(message.distinctId).not.toContain("request-1");
    expect(message.properties.$process_person_profile).toBe(false);
    expect(analyticsMessage({ event: "channel_message_received", subject: { kind: "anonymous", scope: "channel" } }, production).distinctId).toBe("channel:anonymous");
  });
});

describe("captureServerEvent", () => {
  afterEach(() => {
    setAnalyticsSinkForTests(undefined);
  });

  it("sends the event and never throws", () => {
    const capture = vi.fn();
    setAnalyticsSinkForTests({ capture, flush: () => Promise.resolve() });
    captureServerEvent({ event: "job_processed", properties: { kind: "booking", result: "completed" }, subject: { kind: "anonymous", scope: "job" } }, production);
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ event: "job_processed", properties: expect.objectContaining({ kind: "booking", result: "completed" }) }));

    const failing: AnalyticsSink = {
      capture: () => {
        throw new Error("unreachable");
      },
      flush: () => Promise.reject(new Error("unreachable")),
    };
    setAnalyticsSinkForTests(failing);
    expect(() => captureServerEvent({ event: "x", subject: { kind: "anonymous", scope: "job" } }, production)).not.toThrow();
  });

  it("does nothing without analytics", () => {
    captureServerEvent({ event: "x", subject: { kind: "anonymous", scope: "job" } }, { VERCEL_ENV: "preview" });
    setAnalyticsSinkForTests(null);
    expect(() => captureServerEvent({ event: "x", subject: { kind: "anonymous", scope: "job" } }, production)).not.toThrow();
  });
});
