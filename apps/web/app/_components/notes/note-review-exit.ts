import type { ImessageStatus, MessagesPlatform } from "@lib/contracts/imessage";
import { deepLinkFor } from "@lib/contracts/imessage";
import { type MessagingChannel, whatsAppLinkFor } from "@lib/contracts/messaging-channel";

// Where the note review sends the host when it is done: back to the chat they
// set up in, opened in its app (the sms: link for iMessage, wa.me for WhatsApp,
// t.me for Telegram), or, without a linked chat or an app to open it here, to
// the workspace.

export type NoteReviewExit = { readonly channel: MessagingChannel | null; readonly href: string };

export function noteReviewExit(status: ImessageStatus | null, platform: MessagesPlatform): NoteReviewExit {
  if (status?.state === "linked" && status.lineNumber) {
    const href =
      status.channel === "whatsapp"
        ? whatsAppLinkFor(status.lineNumber, "")?.replace(/\?text=$/, "")
        : status.channel === "telegram"
          ? `https://t.me/${status.lineNumber.replace(/^@/, "")}`
          : deepLinkFor(platform, status.lineNumber, "")?.replace(/[?&]body=$/, "");
    if (href) return { channel: status.channel, href };
  }
  return { channel: null, href: "/app" };
}
