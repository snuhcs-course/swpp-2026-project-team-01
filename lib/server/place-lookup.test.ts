import { describe, expect, it, vi } from "vitest";
import { middle, placeBetween, type PlaceLookupConfig } from "./place-lookup";

// A station between a group's participants (group-scheduling design 5), with
// Google stood in for.

const POINTS: Readonly<Record<string, { lat: number; lng: number }>> = {
  잠실: { lat: 37.513, lng: 127.1 },
  신촌: { lat: 37.555, lng: 126.937 },
};

function config(fetch: typeof globalThis.fetch): PlaceLookupConfig {
  return { apiKey: "key", fetch, geocodingUrl: "https://geocode.test", placesUrl: "https://places.test", timeoutMs: 1000 };
}

function google(options: { readonly places?: unknown; readonly failGeocode?: boolean } = {}) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname === "geocode.test") {
      if (options.failGeocode) return new Response("nope", { status: 500 });
      const point = POINTS[url.searchParams.get("address") ?? ""];
      return Response.json(point ? { results: [{ geometry: { location: point } }], status: "OK" } : { results: [], status: "ZERO_RESULTS" });
    }
    const body = JSON.parse(String(init?.body)) as { locationRestriction: { circle: { center: unknown } } };
    expect(body.locationRestriction.circle.center).toEqual(middle([
      { latitude: POINTS["신촌"]!.lat, longitude: POINTS["신촌"]!.lng },
      { latitude: POINTS["잠실"]!.lat, longitude: POINTS["잠실"]!.lng },
    ]));
    return Response.json({ places: options.places ?? [{ displayName: { text: "선릉역" }, formattedAddress: "서울 강남구 선릉로 지하 580" }] });
  }) as unknown as typeof globalThis.fetch;
}

describe("a place between participants", () => {
  it("names the station nearest the middle of their places", async () => {
    await expect(placeBetween(config(google()), ["신촌", "잠실"])).resolves.toBe("선릉역, 서울 강남구 선릉로 지하 580");
  });

  it("needs two distinct places", async () => {
    const fetch = google();
    await expect(placeBetween(config(fetch), ["신촌", " 신촌 "])).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("finds nothing when geocoding fails", async () => {
    await expect(placeBetween(config(google({ failGeocode: true })), ["신촌", "잠실"])).resolves.toBeNull();
  });

  it("finds nothing when no station is near", async () => {
    await expect(placeBetween(config(google({ places: [] })), ["신촌", "잠실"])).resolves.toBeNull();
  });

  it("calls nothing without a key", async () => {
    const fetch = google();
    await expect(placeBetween({ ...config(fetch), apiKey: "" }, ["신촌", "잠실"])).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
