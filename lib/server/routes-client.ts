import { createHmac } from "node:crypto";
import type { Database } from "./database";
import { deploymentEnvironment } from "./deployment";
import { departureSlot, type LegQuery, legQueryKey, type RouteMode, type RouteOutcome } from "./feasibility";
import type { TokenKey } from "./token-encryption";

// Google Routes for travel legs (design decision 9). computeRoutes with address
// waypoints, the leg's mode and departure time, traffic-aware for driving, and the
// field mask routes.duration,routes.distanceMeters, which keeps calls in the basic
// billing tier. No route, an unsupported mode or a failure leaves the leg
// unresolved; nothing here ever turns a missing estimate into zero travel.
// Estimates are cached in app.route_estimates for 24 hours per endpoints, mode and
// 15-minute departure slot, keyed by keyed hashes: no cleartext location is stored.

export const GOOGLE_ROUTES_API_URL = "https://routes.googleapis.com";
export const ROUTES_REQUEST_TIMEOUT_MS = 8_000;
export const ROUTE_ESTIMATE_TTL_HOURS = 24;
// Routes calls in flight at once within one evaluation.
const ROUTES_CONCURRENCY = 6;
const FIELD_MASK = "routes.duration,routes.distanceMeters";

const TRAVEL_MODES: Readonly<Record<RouteMode, string>> = {
  driving: "DRIVE",
  transit: "TRANSIT",
  walking: "WALK",
};

export type RoutesConfig = {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
};

type Environment = Readonly<Record<string, string | undefined>>;

// GOOGLE_ROUTES_API_URL points tests and local runs at a stand-in; production
// always calls Google. The key is the server key restricted to the Routes API.
export function routesConfigFromEnvironment(env: Environment = process.env): RoutesConfig {
  const overridable = deploymentEnvironment(env) !== "production";

  return {
    apiKey: env.GOOGLE_MAPS_API_KEY?.trim() ?? "",
    baseUrl: (overridable && env.GOOGLE_ROUTES_API_URL?.trim()) || GOOGLE_ROUTES_API_URL,
    timeoutMs: ROUTES_REQUEST_TIMEOUT_MS,
  };
}

export type RouteEstimate = RouteOutcome & { readonly distanceMeters?: number | null };

// Google writes durations as seconds with an "s" suffix, such as "1234s".
function seconds(duration: unknown) {
  const match = typeof duration === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(duration) : null;
  return match ? Math.round(Number(match[1])) : null;
}

// One computeRoutes call. A cancelled signal rejects, so the caller's deadline
// decides what happens next; every other failure resolves as `failed`.
export async function computeRoute(
  config: RoutesConfig,
  leg: Pick<LegQuery, "origin" | "destination" | "mode" | "departure">,
  options: { readonly signal?: AbortSignal; readonly now?: Date } = {},
): Promise<RouteEstimate> {
  if (!config.apiKey) return { outcome: "failed" };

  // Google refuses departures in the past; a leg departing earlier today is
  // estimated as if leaving now, while the cache keeps the leg's own slot.
  const now = (options.now ?? new Date()).getTime();
  const departure = new Date(Math.max(leg.departure.getTime(), now + 60_000));
  const mode = TRAVEL_MODES[leg.mode];
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;

  try {
    const response = await (config.fetch ?? fetch)(`${config.baseUrl}/directions/v2:computeRoutes`, {
      body: JSON.stringify({
        departureTime: departure.toISOString(),
        destination: { address: leg.destination },
        origin: { address: leg.origin },
        travelMode: mode,
        ...(mode === "DRIVE" ? { routingPreference: "TRAFFIC_AWARE" } : {}),
      }),
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey, "x-goog-fieldmask": FIELD_MASK },
      method: "POST",
      signal,
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { outcome: "failed" };
    }

    const body = (await response.json()) as { routes?: { duration?: unknown; distanceMeters?: unknown }[] };
    const route = body.routes?.[0];
    if (!route) return { outcome: "no_route" };

    const durationSeconds = seconds(route.duration);
    if (durationSeconds === null) return { outcome: "failed" };

    return {
      distanceMeters: typeof route.distanceMeters === "number" ? route.distanceMeters : null,
      durationSeconds,
      outcome: "route",
    };
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    return { outcome: "failed" };
  }
}

// The keyed hash of a location text, under a key derived from the token key, so a
// stored hash cannot be matched to an address by enumerating addresses without it.
// Spacing and letter case are not a different place.
export function endpointHasher(key: TokenKey) {
  const derived = createHmac("sha256", key.key).update("find-me-a-time/route-endpoint/v1").digest();

  return (text: string) =>
    createHmac("sha256", derived)
      .update(text.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase())
      .digest("base64url");
}

export type TravelDependencies = {
  readonly db: Database;
  readonly config: RoutesConfig;
};

// Estimates for every query: saved ones younger than 24 hours first, then one
// Routes call per remaining query, a few at a time. A route or a definite no-route
// is saved; a failure is not, so the next evaluation asks again. Cache writes
// commit on their own, outside the evaluation's transaction, so concurrent
// evaluations of the same trip never wait on each other's locks.
export async function estimateTravel(
  deps: TravelDependencies,
  queries: readonly LegQuery[],
  // maxAgeHours: how old a saved estimate may be (24 hours by default; booking
  // revalidation asks for one hour).
  options: { readonly signal?: AbortSignal; readonly now?: Date; readonly maxAgeHours?: number } = {},
): Promise<Map<string, RouteEstimate>> {
  const estimates = new Map<string, RouteEstimate>();
  if (queries.length === 0) return estimates;

  const saved = await deps.db<
    {
      departure_slot: Date;
      destination_hash: string;
      distance_meters: number | null;
      duration_seconds: number | null;
      mode: RouteMode;
      origin_hash: string;
      outcome: "route" | "no_route";
    }[]
  >`
    select origin_hash, destination_hash, mode, departure_slot, outcome, duration_seconds, distance_meters
    from app.route_estimates
    where origin_hash = any(${queries.map((query) => query.originKey)}::text[])
      and departure_slot = any(${queries.map((query) => departureSlot(query.departure).toISOString())}::text[]::timestamptz[])
      and outcome in ('route', 'no_route')
      and fetched_at > now() - make_interval(hours => ${Math.min(options.maxAgeHours ?? ROUTE_ESTIMATE_TTL_HOURS, ROUTE_ESTIMATE_TTL_HOURS)})
  `;

  for (const row of saved) {
    const key = legQueryKey({
      departure: row.departure_slot,
      destinationKey: row.destination_hash,
      mode: row.mode,
      originKey: row.origin_hash,
    });
    estimates.set(
      key,
      row.outcome === "route"
        ? { distanceMeters: row.distance_meters, durationSeconds: row.duration_seconds!, outcome: "route" }
        : { outcome: "no_route" },
    );
  }

  const missing = queries.filter((query) => !estimates.has(legQueryKey(query)));
  let next = 0;

  async function worker() {
    while (next < missing.length) {
      const query = missing[next]!;
      next += 1;
      options.signal?.throwIfAborted();

      const estimate = await computeRoute(deps.config, query, options);
      estimates.set(legQueryKey(query), estimate);

      if (estimate.outcome !== "failed" && !options.signal?.aborted) {
        await deps.db`
          insert into app.route_estimates as saved
            (origin_hash, destination_hash, mode, departure_slot, outcome, duration_seconds, distance_meters)
          values (
            ${query.originKey}, ${query.destinationKey}, ${query.mode}, ${departureSlot(query.departure)},
            ${estimate.outcome}, ${estimate.outcome === "route" ? estimate.durationSeconds : null},
            ${estimate.outcome === "route" ? (estimate.distanceMeters ?? null) : null}
          )
          on conflict (origin_hash, destination_hash, mode, departure_slot) do update set
            outcome = excluded.outcome, duration_seconds = excluded.duration_seconds,
            distance_meters = excluded.distance_meters, fetched_at = now()
        `;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(ROUTES_CONCURRENCY, missing.length) }, worker));
  return estimates;
}
