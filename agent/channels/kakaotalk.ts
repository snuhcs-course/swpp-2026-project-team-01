import { defineChannel, POST } from "eve/channels";
import { receiveKakaoTalkClaim, receiveKakaoTalkHeartbeat, receiveKakaoTalkResult } from "../../lib/server/kakaotalk-outbox";
import { receiveKakaoTalkWebhook } from "../../lib/server/kakaotalk-receiver";

// The host KakaoTalk channel (host-kakaotalk-channel design 2, 5 and 7): the
// relay phone's four signed routes and nothing else. The webhook stores a
// deduplicated receipt and its job before acknowledging and never starts or
// continues a session here; the receipt job decides what a message may do. The
// relay pulls outgoing messages through the claim and reports each one's end.
// Every route refuses outside a release origin before it reads delivery state.
// vercel.ts routes /kakaotalk/* to this service.
export default defineChannel({
  routes: [
    POST("/kakaotalk/webhook", (request) => receiveKakaoTalkWebhook(request)),
    POST("/kakaotalk/outbox/claim", (request) => receiveKakaoTalkClaim(request)),
    POST("/kakaotalk/outbox/:id/result", (request, { params }) => receiveKakaoTalkResult(request, params.id ?? "")),
    POST("/kakaotalk/heartbeat", (request) => receiveKakaoTalkHeartbeat(request)),
  ],
});
