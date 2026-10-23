import { defineChannel, POST } from "eve/channels";
import { receivePhotonWebhook } from "../../lib/server/photon-receiver";

// The host iMessage channel (host-imessage-channel design 1 and 2, D1): the
// signed Photon receiver and nothing else. It stores a deduplicated receipt and
// its job before acknowledging, and never starts or continues a session here: the
// application job maps a bound sender to the host's selected discussion, runs
// exact commands before any model turn, and forwards free text through the same
// path as /app, so unlinked and group senders never get a session. vercel.ts
// routes /photon/* to this service.
export default defineChannel({
  routes: [POST("/photon/webhook", (request) => receivePhotonWebhook(request))],
});
