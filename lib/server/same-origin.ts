// The origins one deployment serves, and cross-site request refusal.
//
// APP_ORIGIN is the canonical origin; APP_ALLOWED_ORIGINS lists any others the
// same deployment serves independently (such as a release host). A request is
// served for the origin it was addressed to only when that origin is listed, so
// a forged Host header can neither steer a redirect nor pass the CSRF check.

export type AppOrigins = {
  // The canonical origin (APP_ORIGIN).
  readonly appOrigin: string;
  // Further origins the deployment serves (APP_ALLOWED_ORIGINS).
  readonly allowedOrigins?: readonly string[];
};

export function listedOrigins(origins: AppOrigins) {
  return [origins.appOrigin, ...(origins.allowedOrigins ?? [])].map((origin) => new URL(origin).origin);
}

function firstValue(header: string | null) {
  return header?.split(",")[0]?.trim() || null;
}

// The origin the request was addressed to, from the forwarding proxy's headers
// or the request URL.
export function addressedOrigin(request: Request) {
  const url = new URL(request.url);
  const host = firstValue(request.headers.get("x-forwarded-host")) ?? firstValue(request.headers.get("host")) ?? url.host;
  const protocol = firstValue(request.headers.get("x-forwarded-proto")) ?? url.protocol.slice(0, -1);

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

// The listed origin the request was addressed to, or null for an unlisted host.
export function requestAppOrigin(request: Request, origins: AppOrigins) {
  const origin = addressedOrigin(request);
  return origin && listedOrigins(origins).includes(origin) ? origin : null;
}

export function unknownHost() {
  return Response.json(
    { code: "unknown_host", error: "This host is not served here." },
    { headers: { "cache-control": "private, no-store" }, status: 421 },
  );
}

// Cross-site request refusal for state-changing routes. A browser sends Origin
// on every POST, so a request whose Origin is missing, or is not the listed
// origin the request was addressed to, is refused; another listed origin is
// refused too, since its pages are a different site's. A JSON route also refuses
// any other content type, which a cross-site form cannot send without a CORS
// preflight. Null means allowed.
export function crossSiteRefusal(
  request: Request,
  origins: string | AppOrigins,
  options: { readonly json: boolean },
) {
  const own = requestAppOrigin(request, typeof origins === "string" ? { appOrigin: origins } : origins);
  const origin = request.headers.get("origin");

  if (!own || !origin || origin !== own) {
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

export function appOriginsFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): AppOrigins {
  const appOrigin = env.APP_ORIGIN;

  if (!appOrigin) {
    throw new Error("APP_ORIGIN is not set.");
  }

  const allowedOrigins = (env.APP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin);

  return { allowedOrigins, appOrigin: new URL(appOrigin).origin };
}

export function appOriginFromEnvironment() {
  return appOriginsFromEnvironment().appOrigin;
}
