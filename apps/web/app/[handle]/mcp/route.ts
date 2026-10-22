import { createMcpHandler } from "@lib/server/agent-mcp";

const handle = createMcpHandler("requester");

// One ready host's requester MCP endpoint (Streamable HTTP, stateless).
export function POST(request: Request, context: { params: Promise<{ handle: string }> }) {
  return handle(request, context);
}

export function GET(request: Request, context: { params: Promise<{ handle: string }> }) {
  return handle(request, context);
}

export function DELETE(request: Request, context: { params: Promise<{ handle: string }> }) {
  return handle(request, context);
}
