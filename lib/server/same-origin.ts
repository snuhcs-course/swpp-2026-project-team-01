// Cross-site request refusal for state-changing routes. A browser sends Origin
// on every POST, so a request whose Origin is missing or is not the app's own is
// refused, and a JSON route also refuses any other content type, which a
// cross-site form cannot send without a CORS preflight. Null means allowed.
export function crossSiteRefusal(request: Request, appOrigin: string, options: { readonly json: boolean }) {
  const origin = request.headers.get("origin");

  if (!origin || origin !== new URL(appOrigin).origin) {
    return Response.json(
      { code: "forbidden_origin", error: "This request must come from the app." },
      { headers: { "cache-control": "private, no-store" }, status: 403 },
    );
  }

  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();

  if (options.json && type !== "application/json") {
    return Response.json(
      { code: "unsupported_media_type", error: "Send JSON." },
      { headers: { "cache-control": "private, no-store" }, status: 415 },
    );
  }

  return null;
}

export function appOriginFromEnvironment() {
  const appOrigin = process.env.APP_ORIGIN;

  if (!appOrigin) {
    throw new Error("APP_ORIGIN is not set.");
  }

  return new URL(appOrigin).origin;
}
