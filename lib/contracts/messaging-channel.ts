// The host's messaging channels (host-whatsapp-channel D5 to D7,
// host-telegram-channel D5 to D7): a host links one of them at a time.
// Browser-safe: the card and the link step pick the channel a device is offered
// here, and build WhatsApp's one-tap link.

export const MESSAGING_CHANNELS = ["imessage", "whatsapp", "telegram"] as const;

export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

// The channels the receipts, links, bindings and outbox can record: since Lane B
// of host-telegram-channel, every channel the screens offer.
export type StoredChannel = MessagingChannel;

export function isMessagingChannel(value: unknown): value is MessagingChannel {
  return (MESSAGING_CHANNELS as readonly unknown[]).includes(value);
}

// What a deployment can link to, null where a channel is not configured: the
// iMessage line's number, the WhatsApp number as digits and the Telegram bot's
// username (TELEGRAM_BOT_USERNAME).
export type ConfiguredChannels = { readonly [Channel in MessagingChannel]: string | null };

// The configured channels in the order the screens list them.
export function configuredChannels(channels: ConfiguredChannels): MessagingChannel[] {
  return MESSAGING_CHANNELS.filter((channel) => Boolean(channels[channel]));
}

// What a device is offered (D7): Android has no iMessage, so it gets WhatsApp
// alone; an iPhone, iPad or Mac gets iMessage with a way to use WhatsApp
// instead; any other computer asks which app the host uses on their phone.
export type ChannelOffer = "whatsapp" | "imessage" | "ask";

export function channelOffer(userAgent: string): ChannelOffer {
  if (/Android/.test(userAgent)) return "whatsapp";
  // An iPad may report a Macintosh user agent; both have Messages.
  if (/iPhone|iPad|iPod|Macintosh/.test(userAgent)) return "imessage";
  return "ask";
}

export const WHATSAPP_NUMBER = /^[1-9]\d{7,14}$/;

// WhatsApp's one-tap link (D6): wa.me with the line's number as digits and the
// message percent-encoded. It opens WhatsApp on a phone and WhatsApp Web or the
// desktop app on a computer, and the QR code carries the same URL.
export function whatsAppLinkFor(number: string, text: string) {
  const digits = number.replace(/^\+/, "");
  if (!WHATSAPP_NUMBER.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// A WhatsApp number as the card shows it: the digits with a leading plus.
export function displayWhatsAppNumber(number: string) {
  return `+${number.replace(/^\+/, "")}`;
}

// The numbers a deployment can link to, null where a channel is not configured.
type ChannelNumbers = { readonly imessage: string | null; readonly whatsapp: string | null };

// The channel a card or link step shows before any attempt exists (D7): the
// only configured channel, else the host's choice, else the device's offer;
// null when the host must first say which app they use on their phone. An
// attempt or a binding names its own channel, which wins over this.
export function shownChannel(offer: ChannelOffer, channels: ChannelNumbers, chosen: MessagingChannel | null = null): MessagingChannel | null {
  if (!channels.imessage && !channels.whatsapp) return null;
  if (!channels.imessage) return "whatsapp";
  if (!channels.whatsapp) return "imessage";
  if (chosen) return chosen;
  return offer === "ask" ? null : offer;
}

// The other channel a device may switch to from `current` (D7): none on
// Android, which has no iMessage, and none when the other is not configured.
export function otherChannel(offer: ChannelOffer, channels: ChannelNumbers, current: MessagingChannel): MessagingChannel | null {
  if (offer === "whatsapp") return null;
  const other: MessagingChannel = current === "imessage" ? "whatsapp" : "imessage";
  return channels[other] ? other : null;
}

// The channel's name as the screens show it.
export function channelName(channel: MessagingChannel) {
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "telegram") return "Telegram";
  return "iMessage";
}

// Forwarded text is marked, so the shared transcript and the assistant know
// where it came from (host-imessage-channel D11). A host's words approve a
// proposal only in a message that carries one of these (D23).
export const IMESSAGE_PREFIX = "[iMessage] ";
export const WHATSAPP_PREFIX = "[WhatsApp] ";

export function cameFromMessagingChannel(message: string) {
  return message.startsWith(IMESSAGE_PREFIX) || message.startsWith(WHATSAPP_PREFIX);
}
