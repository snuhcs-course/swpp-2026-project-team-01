import { defineChannel, POST } from "eve/channels";
import { receiveAgentMailWebhook } from "../../lib/server/agentmail-receiver";

// The requester email channel (requester-email-channel design 1, D1): the signed
// AgentMail receiver and nothing else. It stores a deduplicated receipt and its
// job before acknowledging, and never starts or continues a session here: the
// application job decides what a message may do and forwards verified text into
// the request's own requester discussion, which the eve channel serves. vercel.ts
// routes /agentmail/* to this service.
export default defineChannel({
  routes: [
    POST("/agentmail/webhooks/:receiverId", (request, { params }) =>
      receiveAgentMailWebhook(request, params.receiverId ?? ""),
    ),
  ],
});
