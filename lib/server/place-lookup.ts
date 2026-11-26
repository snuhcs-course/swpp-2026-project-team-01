import { deploymentEnvironment } from "./deployment";

// A place between a group's participants (group-scheduling design 5, D16): the
// third tier of in-person place candidates. Each participant's usual place is
// geocoded with the Geocoding API, the point in the middle is taken, and the
// Places API (New) names the nearest transit station to it. Any failure leaves
// the tier empty: nothing here turns a failed lookup into a place.
// GOOGLE_MAPS_API_KEY must allow the Geocoding API and the Places API (New)
// besides the Routes API (#487).

export const GOOGLE_GEOCODING_API_URL = "https://maps.googleapis.com";
export const GOOGLE_PLACES_API_URL = "https://places.googleapis.com";
export const PLACE_LOOKUP_TIMEOUT_MS = 8_000;
// How far from the middle a station may be.
export const MIDPOINT_RADIUS_METERS = 3_000;
const STATION_TYPES = ["subway_station", "train_station", "transit_station"];
const FIELD_MASK = "places.displayName,places.formattedAddress";

export type PlaceLookupConfig = {
  readonly apiKey: string;
  readonly geocodingUrl: string;
  readonly placesUrl: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
};

type Environment = Readonly<Record<string, string | undefined>>;

// GOOGLE_GEOCODING_API_URL and GOOGLE_PLACES_API_URL point tests and local runs
// at a stand-in; production always calls Google.
export function placeLookupConfigFromEnvironment(env: Environment = process.env): PlaceLookupConfig {
  const overridable = deploymentEnvironment(env) !== "production";
  return {
    apiKey: env.GOOGLE_MAPS_API_KEY?.trim() ?? "",
    geocodingUrl: (overridable && env.GOOGLE_GEOCODING_API_URL?.trim()) || GOOGLE_GEOCODING_API_URL,
    placesUrl: (overridable && env.GOOGLE_PLACES_API_URL?.trim()) || GOOGLE_PLACES_API_URL,
    timeoutMs: PLACE_LOOKUP_TIMEOUT_MS,
  };
}

export type Coordinates = { readonly latitude: number; readonly longitude: number };

function signalOf(config: PlaceLookupConfig, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

// The first Geocoding result's location, or null.
export async function geocode(config: PlaceLookupConfig, address: string, options: { readonly signal?: AbortSignal } = {}): Promise<Coordinates | null> {
  if (!config.apiKey) return null;
  const url = new URL(`${config.geocodingUrl}/maps/api/geocode/json`);
  url.searchParams.set("address", address);
  url.searchParams.set("key", config.apiKey);
  try {
    const response = await (config.fetch ?? fetch)(url, { signal: signalOf(config, options.signal) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const body = (await response.json()) as { status?: string; results?: { geometry?: { location?: { lat?: unknown; lng?: unknown } } }[] };
    const location = body.status === "OK" ? body.results?.[0]?.geometry?.location : undefined;
    return typeof location?.lat === "number" && typeof location.lng === "number" ? { latitude: location.lat, longitude: location.lng } : null;
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    return null;
  }
}

// The nearest transit station to a point, as its name and address, or null.
export async function nearestStation(config: PlaceLookupConfig, center: Coordinates, options: { readonly signal?: AbortSignal } = {}): Promise<string | null> {
  if (!config.apiKey) return null;
  try {
    const response = await (config.fetch ?? fetch)(`${config.placesUrl}/v1/places:searchNearby`, {
      body: JSON.stringify({
        includedTypes: STATION_TYPES,
        locationRestriction: { circle: { center, radius: MIDPOINT_RADIUS_METERS } },
        maxResultCount: 1,
        rankPreference: "DISTANCE",
      }),
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey, "x-goog-fieldmask": FIELD_MASK },
      method: "POST",
      signal: signalOf(config, options.signal),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const body = (await response.json()) as { places?: { displayName?: { text?: unknown }; formattedAddress?: unknown }[] };
    const place = body.places?.[0];
    const name = typeof place?.displayName?.text === "string" ? place.displayName.text.trim() : "";
    const address = typeof place?.formattedAddress === "string" ? place.formattedAddress.trim() : "";
    const text = [name, address].filter(Boolean).join(", ");
    return text ? text.slice(0, 500) : null;
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    return null;
  }
}

// The middle of the places' coordinates (their mean, which is close enough at
// the distances people meet across).
export function middle(points: readonly Coordinates[]): Coordinates {
  return {
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
  };
}

// A station between at least two distinct places, or null.
export async function placeBetween(config: PlaceLookupConfig, places: readonly string[], options: { readonly signal?: AbortSignal } = {}): Promise<string | null> {
  const distinct = [...new Set(places.map((place) => place.trim()).filter(Boolean))];
  if (distinct.length < 2) return null;
  const points: Coordinates[] = [];
  for (const place of distinct) {
    const point = await geocode(config, place, options);
    if (point) points.push(point);
  }
  return points.length >= 2 ? nearestStation(config, middle(points), options) : null;
}
