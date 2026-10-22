import { type AgentRole, AGENT_SCOPES, roleScopes } from "../contracts/agent-access";
import { isUsableHandle, normalizeHandle } from "../contracts/handles";
import type { Queryable } from "./database";
import { findReadyHostByHandle } from "./readiness";

// The protected resources and discovery documents (agent-access D5, design 2).
// Each listed origin is its own issuer. {origin}/mcp is the host resource and
// {origin}/{handle}/mcp the requester resource of one ready host; a resource is
// always compared in this canonical form, without a query, fragment or trailing
// slash.

export const MCP_SERVER_NAME = "Find Me a Time";

export type AgentResource =
  | { readonly role: "host"; readonly resource: string }
  | {
      readonly role: "requester";
      readonly resource: string;
      readonly handle: string;
      readonly hostAccountId: string;
      readonly displayName: string;
    };

export function hostResource(origin: string) {
  return `${origin}/mcp`;
}

export function requesterResource(origin: string, handle: string) {
  return `${origin}/${handle}/mcp`;
}

// The handle a requester resource path names, without checking the host.
export function resourcePath(origin: string, resource: string): { role: "host" } | { role: "requester"; handle: string } | null {
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    return null;
  }

  if (url.origin !== origin || url.search || url.hash || resource.includes("#") || resource.includes("?")) return null;
  if (url.pathname === "/mcp") return { role: "host" };

  const match = url.pathname.match(/^\/([^/]+)\/mcp$/);
  const handle = match ? normalizeHandle(decodeURIComponent(match[1]!)) : null;
  return handle && isUsableHandle(handle) ? { handle, role: "requester" } : null;
}

// The resource a `resource` value names on this origin, or null: another
// origin, another path, or a handle that is unknown, unready or suspended.
export async function resolveResource(db: Queryable, origin: string, resource: string): Promise<AgentResource | null> {
  const path = resourcePath(origin, resource);
  if (!path) return null;
  if (path.role === "host") return { resource: hostResource(origin), role: "host" };

  const host = await findReadyHostByHandle(db, path.handle);
  return host
    ? { displayName: host.displayName, handle: host.handle, hostAccountId: host.hostAccountId, resource: requesterResource(origin, host.handle), role: "requester" }
    : null;
}

export function resourceMetadataUrl(origin: string, resource: string) {
  return `${origin}/.well-known/oauth-protected-resource${new URL(resource).pathname}`;
}

// RFC 9728 protected resource metadata.
export function protectedResourceMetadata(origin: string, resource: string, role: AgentRole) {
  return {
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    resource,
    resource_name: role === "host" ? `${MCP_SERVER_NAME} for hosts` : `${MCP_SERVER_NAME} for requesters`,
    scopes_supported: [...roleScopes(role)],
  };
}

// RFC 8414 authorization server metadata.
export function authorizationServerMetadata(origin: string) {
  return {
    authorization_endpoint: `${origin}/connect/authorize`,
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    issuer: origin,
    jwks_uri: `${origin}/.well-known/jwks.json`,
    registration_endpoint: `${origin}/oauth/register`,
    response_modes_supported: ["query"],
    response_types_supported: ["code"],
    revocation_endpoint: `${origin}/oauth/revoke`,
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...AGENT_SCOPES],
    service_documentation: `${origin}/SKILL.md`,
    token_endpoint: `${origin}/oauth/token`,
    token_endpoint_auth_methods_supported: ["none"],
  };
}

const quoted = (value: string) => `"${value.replace(/["\\]/g, "")}"`;

// The WWW-Authenticate challenge for a missing or invalid token (401) or an
// insufficient one (403), naming the resource metadata and the scopes needed.
export function bearerChallenge(
  origin: string,
  resource: string,
  scopes: readonly string[],
  error?: { readonly code: "invalid_token" | "insufficient_scope"; readonly description: string },
) {
  const parts = [`resource_metadata=${quoted(resourceMetadataUrl(origin, resource))}`, `scope=${quoted(scopes.join(" "))}`];
  if (error) {
    parts.unshift(`error=${quoted(error.code)}`);
    parts.push(`error_description=${quoted(error.description)}`);
  }
  return `Bearer ${parts.join(", ")}`;
}

export const PUBLIC_METADATA_HEADERS = {
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=300",
  "content-type": "application/json",
} as const;
