import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for Google Routes computeRoutes, so tests drive the real Routes
// client (and the browser tests the real app, pointed at it with
// GOOGLE_ROUTES_API_URL) without a network call. Routes are fixtures by
// "origin -> destination" and mode: minutes, "none" for Google's empty answer
// (no route) or "error" for a server error. Unknown trips have no route. A trip
// marked "stall" answers nothing, as a provider that never settles.

export type FakeRoute = number | "none" | "error" | "stall";

export type FakeRoutesRequest = {
  readonly origin: string;
  readonly destination: string;
  readonly travelMode: string;
  readonly departureTime: string;
  readonly routingPreference: string | null;
  readonly apiKey: string | null;
  readonly fieldMask: string | null;
};

export type FakeRoutes = {
  readonly baseUrl: string;
  readonly requests: FakeRoutesRequest[];
  // Keyed by `${origin} -> ${destination}` and the mode: DRIVE, TRANSIT or WALK.
  setRoute(origin: string, destination: string, mode: string, route: FakeRoute): void;
  close(): Promise<void>;
};

export const FAKE_ROUTES_API_KEY = "fake-routes-key";

export async function startFakeRoutes(options: { readonly port?: number } = {}): Promise<FakeRoutes> {
  const routes = new Map<string, FakeRoute>();
  const requests: FakeRoutesRequest[] = [];

  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const url = new URL(request.url ?? "/", "http://fake-routes");

    if (request.method !== "POST" || url.pathname !== "/directions/v2:computeRoutes") {
      response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: 404 } }));
      return;
    }

    const body = JSON.parse(raw) as {
      origin?: { address?: string };
      destination?: { address?: string };
      travelMode?: string;
      departureTime?: string;
      routingPreference?: string;
    };
    const entry: FakeRoutesRequest = {
      apiKey: (request.headers["x-goog-api-key"] as string | undefined) ?? null,
      departureTime: body.departureTime ?? "",
      destination: body.destination?.address ?? "",
      fieldMask: (request.headers["x-goog-fieldmask"] as string | undefined) ?? null,
      origin: body.origin?.address ?? "",
      routingPreference: body.routingPreference ?? null,
      travelMode: body.travelMode ?? "",
    };
    requests.push(entry);

    if (entry.apiKey !== FAKE_ROUTES_API_KEY || !entry.fieldMask) {
      response.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: 403 } }));
      return;
    }

    const route = routes.get(`${entry.origin} -> ${entry.destination}|${entry.travelMode}`) ?? "none";

    if (route === "stall") return;

    if (route === "error") {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: 500 } }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(route === "none" ? {} : { routes: [{ distanceMeters: route * 400, duration: `${route * 60}s` }] }),
    );
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    requests,
    setRoute: (origin, destination, mode, route) => routes.set(`${origin} -> ${destination}|${mode}`, route),
  };
}
