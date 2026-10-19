import { describe, expect, it } from "vitest";
import { deploymentEnvironment } from "./deployment";

describe("deployment environment", () => {
  it.each([
    [{}, "local"],
    [{ VERCEL: "1", VERCEL_ENV: "production" }, "production"],
    [{ VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" }, "production"],
    [{ VERCEL: "1", VERCEL_ENV: "preview" }, "preview"],
    [{ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "staging" }, "preview"],
    [{ VERCEL: "1", VERCEL_ENV: "development" }, "development"],
  ])("reads %j as %s", (env, expected) => {
    expect(deploymentEnvironment(env)).toBe(expected);
  });

  it.each([
    [{ VERCEL_ENV: "production" }],
    [{ VERCEL: "0", VERCEL_ENV: "production" }],
    [{ VERCEL: "1" }],
    [{ VERCEL: "1", VERCEL_ENV: "staging" }],
    [{ VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "staging" }],
    [{ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "production" }],
    [{ VERCEL: "1", VERCEL_ENV: "development", VERCEL_TARGET_ENV: "production" }],
    [{ VERCEL_TARGET_ENV: "production" }],
  ])("treats missing or contradictory metadata %j as unknown", (env) => {
    expect(deploymentEnvironment(env)).toBe("unknown");
  });
});
