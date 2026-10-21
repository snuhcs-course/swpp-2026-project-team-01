import { describe, expect, it } from "vitest";
import { GOOGLE_ROUTES_API_URL, routesConfigFromEnvironment } from "./routes-client";

describe("routesConfigFromEnvironment", () => {
  it("points local runs at a stand-in but production always at Google", () => {
    const stand = { GOOGLE_MAPS_API_KEY: " key ", GOOGLE_ROUTES_API_URL: "http://127.0.0.1:3104" };

    expect(routesConfigFromEnvironment(stand)).toMatchObject({ apiKey: "key", baseUrl: "http://127.0.0.1:3104" });
    expect(routesConfigFromEnvironment({ ...stand, VERCEL: "1", VERCEL_ENV: "production" }).baseUrl).toBe(
      GOOGLE_ROUTES_API_URL,
    );
    expect(routesConfigFromEnvironment({}).apiKey).toBe("");
  });
});
