import { handleProblem, normalizeHandle } from "../contracts/handles";
import { type Queryable, database } from "./database";
import {
  hostEntryDocument,
  llmsTxt,
  requesterEntryDocument,
  unavailableHostDocument,
} from "./entry-documents";
import { findReadyHostByHandle } from "./readiness";
import { type AppOrigins, appOriginsFromEnvironment, requestAppOrigin } from "./same-origin";

// Route handlers for the public entry documents. They never read or write
// cookies (the session proxy skips their paths), are never cached, and build
// links from the listed origin the request was addressed to, else APP_ORIGIN.

export type PublicRouteDependencies = AppOrigins & {
  readonly db: Queryable;
};

function originsFromEnvironment(): AppOrigins {
  return appOriginsFromEnvironment();
}

function dependenciesFromEnvironment(): PublicRouteDependencies {
  return { ...appOriginsFromEnvironment(), db: database() };
}

function documentOrigin(request: Request, origins: AppOrigins) {
  return requestAppOrigin(request, origins) ?? origins.appOrigin;
}

const MARKDOWN = "text/markdown; charset=utf-8";

function documentResponse(body: string, status: number, headers: Record<string, string>) {
  return new Response(body, { headers: { "cache-control": "no-store", ...headers }, status });
}

// GET /SKILL.md: the host entry document. `/` negotiates to it, so it varies by Accept.
export function createRootSkillHandler(load: () => AppOrigins = originsFromEnvironment) {
  return (request: Request) =>
    documentResponse(hostEntryDocument(documentOrigin(request, load())), 200, {
      "content-type": MARKDOWN,
      vary: "Accept",
    });
}

// GET /{handle}/SKILL.md: the requester document of a ready host. Every other
// case (invalid, reserved, unknown, released, unready or suspended) gets the same
// neutral 404; a database failure is a retryable 503.
export function createHostSkillHandler(load: () => PublicRouteDependencies = dependenciesFromEnvironment) {
  return async (request: Request, segment: string) => {
    const deps = load();
    const origin = documentOrigin(request, deps);
    const headers = { "content-type": MARKDOWN, vary: "Accept", "x-robots-tag": "noindex" };
    const handle = normalizeHandle(segment);

    if (handleProblem(handle)) return documentResponse(unavailableHostDocument(origin), 404, headers);

    let host: Awaited<ReturnType<typeof findReadyHostByHandle>>;

    try {
      host = await findReadyHostByHandle(deps.db, handle);
    } catch {
      return documentResponse(
        `# Temporarily unavailable\n\nThe service could not answer. Try again in 30 seconds.\n`,
        503,
        { ...headers, "retry-after": "30" },
      );
    }

    return host
      ? documentResponse(requesterEntryDocument(origin, host), 200, headers)
      : documentResponse(unavailableHostDocument(origin), 404, headers);
  };
}

// GET /llms.txt: the index of both documents.
export function createLlmsTxtHandler(load: () => AppOrigins = originsFromEnvironment) {
  return (request: Request) =>
    documentResponse(llmsTxt(documentOrigin(request, load())), 200, { "content-type": "text/plain; charset=utf-8" });
}
