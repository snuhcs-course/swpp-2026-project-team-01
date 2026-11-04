import { defineChannel, POST } from "eve/channels";
import { receiveTelegramWebhook } from "../../lib/server/telegram-receiver";

// The host Telegram channel (host-telegram-channel design 2, D2): the bot's
// webhook, checked by its secret header, and nothing else. Like the Photon
// receiver it stores a deduplicated receipt and its job before acknowledging and
// never starts or continues a session here; the receipt job decides what an
// update may do. vercel.ts routes /telegram/* to this service.
export default defineChannel({
  routes: [POST("/telegram/webhook", (request) => receiveTelegramWebhook(request))],
});
