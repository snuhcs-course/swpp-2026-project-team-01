import { createConnectLinkHandler } from "@lib/server/connect-link-routes";
const handle = createConnectLinkHandler();
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(request, (await params).token);
}
