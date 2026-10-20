import { database } from "@lib/server/database";
import { createPhotonWebhookHandler, photonWebhookConfigFromEnvironment } from "@lib/server/photon-webhook";

const handle = createPhotonWebhookHandler(() => ({ config: photonWebhookConfigFromEnvironment(), db: database() }));

// Photon's signed webhook deliveries. A POST handler is never prerendered or cached.
export function POST(request: Request) {
  return handle(request);
}
