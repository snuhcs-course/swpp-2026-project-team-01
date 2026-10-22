import { randomUUID } from "node:crypto";

// The CLI's MCP client: protocol revision 2026-07-28 over Streamable HTTP,
// one stateless POST per request with the per-request metadata and the
// mirrored headers. It speaks to the same endpoints every remote agent uses.

export const PROTOCOL_VERSION = "2026-07-28";
const CLIENT_INFO = { name: "fmat", version: "0.1.0" };

export type McpTool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: { readonly properties?: Record<string, unknown> };
  readonly annotations?: { readonly readOnlyHint?: boolean };
};

export type McpFailure =
  | { readonly kind: "unauthorized" }
  | { readonly kind: "insufficient_scope"; readonly scope: string | null }
  | { readonly kind: "protocol"; readonly status: number; readonly code: number | null; readonly message: string }
  // No answer arrived: the outcome of a mutation is unknown.
  | { readonly kind: "no_response" };

export class McpError extends Error {
  readonly failure: McpFailure;

  constructor(failure: McpFailure) {
    super(failure.kind);
    this.name = "McpError";
    this.failure = failure;
  }
}

function headerValue(value: string) {
  return /^[\x21-\x7e]*$/.test(value) && !/^=\?base64\?.*\?=$/.test(value) ? value : `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export async function rpc(
  resource: string,
  accessToken: string,
  method: string,
  params: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "mcp-method": method,
    "mcp-protocol-version": PROTOCOL_VERSION,
  };
  if (method === "tools/call" && typeof params.name === "string") headers["mcp-name"] = headerValue(params.name);

  let response: Response;
  try {
    response = await fetchImpl(resource, {
      body: JSON.stringify({
        id: randomUUID(),
        jsonrpc: "2.0",
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
            "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
          },
        },
      }),
      headers,
      method: "POST",
    });
  } catch {
    throw new McpError({ kind: "no_response" });
  }

  if (response.status === 401) throw new McpError({ kind: "unauthorized" });
  if (response.status === 403 && /insufficient_scope/.test(response.headers.get("www-authenticate") ?? "")) {
    throw new McpError({ kind: "insufficient_scope", scope: response.headers.get("www-authenticate")?.match(/scope="([^"]*)"/)?.[1] ?? null });
  }

  const body = (await response.json().catch(() => null)) as { result?: Record<string, unknown>; error?: { code?: number; message?: string } } | null;
  if (!body) {
    // A gateway error may come after the operation ran, so its outcome is unknown.
    if (response.status >= 500) throw new McpError({ kind: "no_response" });
    throw new McpError({ code: null, kind: "protocol", message: "The answer was not JSON.", status: response.status });
  }
  if (body.error || !body.result) {
    throw new McpError({ code: body.error?.code ?? null, kind: "protocol", message: body.error?.message ?? "No result.", status: response.status });
  }
  return body.result;
}

export async function listTools(resource: string, accessToken: string, fetchImpl?: typeof fetch) {
  return ((await rpc(resource, accessToken, "tools/list", {}, fetchImpl)).tools ?? []) as McpTool[];
}

export async function callTool(resource: string, accessToken: string, name: string, args: Record<string, unknown>, fetchImpl?: typeof fetch) {
  return (await rpc(resource, accessToken, "tools/call", { arguments: args, name }, fetchImpl)) as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: { type: string; text?: string }[];
  };
}
