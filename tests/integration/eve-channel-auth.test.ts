import { describe, expect, it } from "vitest";
import channel from "../../agent/channels/eve";

type ChannelRoute = {
  readonly handler: (request: Request, context: object) => Promise<Response>;
  readonly method: string;
  readonly path: string;
};

const routes = (channel as unknown as { readonly routes: readonly ChannelRoute[] }).routes;

function findRoute(method: string, path: string) {
  const route = routes.find((candidate) => candidate.method === method && candidate.path === path);

  if (!route) {
    throw new Error(`The eve channel has no ${method} ${path} route.`);
  }

  return route;
}

const protectedRoutes = [
  ["GET", "/eve/v1/info", "/eve/v1/info"],
  ["POST", "/eve/v1/session", "/eve/v1/session"],
  ["POST", "/eve/v1/session/:sessionId", "/eve/v1/session/wrun_foreign"],
  ["GET", "/eve/v1/session/:sessionId/stream", "/eve/v1/session/wrun_foreign/stream"],
] as const;

describe("eve channel auth", () => {
  it.each(protectedRoutes)("denies %s %s without a credential", async (method, path, url) => {
    const response = await findRoute(method, path).handler(
      new Request(`http://localhost${url}`, { method }),
      {},
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "authentication_required", ok: false });
  });

  it.each(protectedRoutes)("denies %s %s with an unrecognized bearer", async (method, path, url) => {
    const response = await findRoute(method, path).handler(
      new Request(`http://localhost${url}`, {
        headers: { authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.e30.signature" },
        method,
      }),
      {},
    );

    expect(response.status).toBe(401);
  });
});
