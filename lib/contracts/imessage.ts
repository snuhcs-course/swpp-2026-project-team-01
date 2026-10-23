// The Connect iMessage card's contract (host-imessage-channel design 4 to 6 and
// 11), as GET /api/host/imessage answers it, and the browser-safe helpers the
// card uses to open Messages (D4). Nothing here ever carries a fallback code the
// service sent, and a sender is only ever shown masked.

export const IMESSAGE_OPERATIONS = [
  "imessage.link.create",
  "imessage.link.confirm",
  "imessage.link.cancel",
  "imessage.link.send_code",
  "imessage.link.verify_code",
  "imessage.unlink",
  "imessage.contact_card.share",
] as const;

export type ImessageOperation = (typeof IMESSAGE_OPERATIONS)[number];

export type ImessageDeliveryState = "queued" | "sent" | "failed" | "uncertain";

export type ImessageDelivery = {
  readonly state: "failed" | "uncertain";
  readonly at: string;
};

export type ImessageStatus =
  // No line is configured for this deployment.
  | { readonly state: "unavailable" }
  | { readonly state: "none"; readonly lineNumber: string }
  // A link code to send from the host's iMessage, as shown.
  | {
      readonly state: "pending";
      readonly lineNumber: string;
      readonly code: string;
      readonly message: string;
      readonly expiresAt: string;
    }
  // The code's message arrived; the host confirms the masked sender.
  | { readonly state: "received"; readonly lineNumber: string; readonly sender: string; readonly confirmBy: string }
  // The fallback: a code sent to the entered number, typed back here.
  | {
      readonly state: "fallback";
      readonly lineNumber: string;
      readonly number: string;
      readonly send: ImessageDeliveryState;
      readonly expiresAt: string | null;
      readonly resendAt: string | null;
      readonly sendsLeft: number;
    }
  | {
      readonly state: "linked";
      readonly lineNumber: string;
      readonly sender: string;
      readonly linkedAt: string;
      // The latest message to the linked conversation that failed or may not have arrived.
      readonly delivery: ImessageDelivery | null;
      readonly contactCard: { readonly state: ImessageDeliveryState } | null;
    };

export const LINK_MESSAGE_PREFIX = "Link my Find Me a Time account:";

export function linkMessage(code: string) {
  return `${LINK_MESSAGE_PREFIX} ${code}`;
}

// The masked sender the card shows: the last four digits of a number, or the
// first character and the domain of an Apple ID email.
export function maskSender(sender: string) {
  if (sender.startsWith("+")) return `•••• ${sender.slice(-4)}`;
  const at = sender.lastIndexOf("@");
  return at > 0 ? `${sender[0]}•••${sender.slice(at)}` : "••••";
}

export type MessagesPlatform = "ios" | "android" | "other";

// Where the Messages app can be opened with a prefilled body: iPhone, iPad and
// iPod, an iPad that reports a Macintosh user agent (it has touch points), and
// Android. Everything else, desktops included, gets the inline card.
export function messagesPlatform(userAgent: string, maxTouchPoints = 0): MessagesPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/.test(userAgent)) return "android";
  return "other";
}

// The sms: deep link for a platform: `&body=` on iOS, `?body=` on Android.
export function deepLinkFor(platform: MessagesPlatform, number: string, text: string) {
  const body = encodeURIComponent(text);
  if (platform === "ios") return `sms:${number}&body=${body}`;
  if (platform === "android") return `sms:${number}?body=${body}`;
  return null;
}

// The deep link a QR code carries: the iOS form, since the MVP targets iPhone hosts.
export function qrDeepLink(number: string, text: string) {
  return deepLinkFor("ios", number, text)!;
}

export const E164_NUMBER = /^\+[1-9]\d{6,14}$/;

// An entered number in E.164, with spaces, dashes, dots and parentheses removed.
export function normalizeNumber(value: string) {
  const compact = value.replace(/[\s().-]/g, "");
  return E164_NUMBER.test(compact) ? compact : null;
}
