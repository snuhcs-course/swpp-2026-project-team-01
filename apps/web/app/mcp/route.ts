import { createMcpHandler } from "@lib/server/agent-mcp";

const handle = createMcpHandler("host");

// The host MCP endpoint (Streamable HTTP, stateless).
export function POST(request: Request) {
  return handle(request);
}

export function GET(request: Request) {
  return handle(request);
}

export function DELETE(request: Request) {
  return handle(request);
}
