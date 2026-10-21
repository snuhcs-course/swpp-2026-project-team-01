import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { departureSlot, type LegQuery } from "../../lib/server/feasibility";
import { computeRoute, endpointHasher, estimateTravel, type RoutesConfig } from "../../lib/server/routes-client";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { testDatabase } from "./support/database";
import { FAKE_ROUTES_API_KEY, type FakeRoutes, startFakeRoutes } from "./support/fake-routes";

const db = testDatabase();
const hash = endpointHasher(parseTokenKey(randomBytes(32).toString("base64")));
let fake: FakeRoutes;
let config: RoutesConfig;

beforeAll(async () => {
  fake = await startFakeRoutes();
  config = { apiKey: FAKE_ROUTES_API_KEY, baseUrl: fake.baseUrl, timeoutMs: 2_000 };
});

afterAll(async () => {
  await fake.close();
  await db.end();
});

// Unique places per test, so suites sharing the local database never read each
// other's cached estimates.
function trip(mode: LegQuery["mode"] = "transit", departure = new Date(Date.now() + 86_400_000)): LegQuery {
  const origin = `Office ${randomUUID()}, Gangnam, Seoul`;
  const destination = `Cafe ${randomUUID()}, Seongsu, Seoul`;
  return { departure, destination, destinationKey: hash(destination), mode, origin, originKey: hash(origin) };
}

describe("Google Routes client", () => {
  it("asks computeRoutes for the leg with address waypoints and the basic field mask", async () => {
    const leg = trip("driving");
    fake.setRoute(leg.origin, leg.destination, "DRIVE", 25);

    expect(await computeRoute(config, leg)).toEqual({ distanceMeters: 10_000, durationSeconds: 1_500, outcome: "route" });
    expect(fake.requests.at(-1)).toMatchObject({
      departureTime: leg.departure.toISOString(),
      destination: leg.destination,
      fieldMask: "routes.duration,routes.distanceMeters",
      origin: leg.origin,
      routingPreference: "TRAFFIC_AWARE",
      travelMode: "DRIVE",
    });
  });

  it("asks transit and walking without a routing preference", async () => {
    for (const [mode, name] of [["transit", "TRANSIT"], ["walking", "WALK"]] as const) {
      const leg = trip(mode);
      fake.setRoute(leg.origin, leg.destination, name, 30);
      await computeRoute(config, leg);
      expect(fake.requests.at(-1)).toMatchObject({ routingPreference: null, travelMode: name });
    }
  });

  it("reports an empty answer as no route and errors as failures", async () => {
    const none = trip();
    const broken = trip();
    fake.setRoute(broken.origin, broken.destination, "TRANSIT", "error");

    expect(await computeRoute(config, none)).toEqual({ outcome: "no_route" });
    expect(await computeRoute(config, broken)).toEqual({ outcome: "failed" });
    expect(await computeRoute({ ...config, apiKey: "" }, broken)).toEqual({ outcome: "failed" });
    expect(await computeRoute({ ...config, apiKey: "wrong" }, broken)).toEqual({ outcome: "failed" });
  });

  it("departs no earlier than now for a leg that left earlier today", async () => {
    const leg = trip("transit", new Date(Date.now() - 3_600_000));
    fake.setRoute(leg.origin, leg.destination, "TRANSIT", 10);
    await computeRoute(config, leg);
    expect(Date.parse(fake.requests.at(-1)!.departureTime)).toBeGreaterThan(Date.now());
  });

  it("rejects with the caller's reason when its signal is cancelled", async () => {
    const leg = trip();
    fake.setRoute(leg.origin, leg.destination, "TRANSIT", "stall");
    const controller = new AbortController();
    const reason = new Error("deadline");
    setTimeout(() => controller.abort(reason), 50);

    await expect(computeRoute({ ...config, timeoutMs: 10_000 }, leg, { signal: controller.signal })).rejects.toBe(reason);
  });
});

describe("route estimate cache", () => {
  it("reuses a saved estimate for the same endpoints, mode and departure slot", async () => {
    const leg = trip();
    fake.setRoute(leg.origin, leg.destination, "TRANSIT", 20);
    const before = fake.requests.length;

    const first = await estimateTravel({ config, db }, [leg]);
    // Seven minutes later is the same 15-minute slot.
    const sameSlot = { ...leg, departure: new Date(departureSlot(leg.departure).getTime() + 7 * 60_000) };
    const second = await estimateTravel({ config, db }, [sameSlot]);

    expect([...first.values()]).toEqual([expect.objectContaining({ durationSeconds: 1_200, outcome: "route" })]);
    expect([...second.values()]).toEqual([expect.objectContaining({ durationSeconds: 1_200, outcome: "route" })]);
    expect(fake.requests.length - before).toBe(1);
  });

  it("asks again for a changed location and after 24 hours", async () => {
    const leg = trip();
    fake.setRoute(leg.origin, leg.destination, "TRANSIT", 20);
    await estimateTravel({ config, db }, [leg]);

    const moved = `Office ${randomUUID()}, Jamsil, Seoul`;
    fake.setRoute(moved, leg.destination, "TRANSIT", 35);
    const before = fake.requests.length;
    const changed = await estimateTravel({ config, db }, [{ ...leg, origin: moved, originKey: hash(moved) }]);
    expect([...changed.values()][0]).toMatchObject({ durationSeconds: 2_100 });

    await db`
      update app.route_estimates set fetched_at = now() - interval '25 hours'
      where origin_hash = ${leg.originKey} and destination_hash = ${leg.destinationKey}
    `;
    await estimateTravel({ config, db }, [leg]);
    expect(fake.requests.length - before).toBe(2);
  });

  it("saves no route but not a failure, and stores no cleartext location", async () => {
    const none = trip();
    const broken = trip();
    fake.setRoute(broken.origin, broken.destination, "TRANSIT", "error");
    await estimateTravel({ config, db }, [none, broken]);

    const rows = await db<{ outcome: string; row: string }[]>`
      select outcome, to_jsonb(r)::text as row from app.route_estimates r
      where origin_hash in (${none.originKey}, ${broken.originKey})
    `;
    expect(rows.map((row) => row.outcome)).toEqual(["no_route"]);
    expect(rows[0]!.row).not.toMatch(/Office|Cafe|Seoul/);

    const before = fake.requests.length;
    await estimateTravel({ config, db }, [none, broken]);
    expect(fake.requests.length - before).toBe(1);
  });

  it("keys the same place written with other spacing or case alike", () => {
    expect(hash("  Cafe Onion,   Seongsu ")).toBe(hash("cafe onion, seongsu"));
    expect(hash("Cafe Onion, Seongsu")).not.toBe(hash("Cafe Onion, Anguk"));
  });
});
