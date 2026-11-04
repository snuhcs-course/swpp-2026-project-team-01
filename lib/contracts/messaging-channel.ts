// The host's messaging channels (host-whatsapp-channel D5 to D7,
// host-telegram-channel D5 to D7): a host links one of them at a time.
// Browser-safe: the card and the link step pick the channel a device is offered
// here, and build WhatsApp's and Telegram's one-tap links.

export const MESSAGING_CHANNELS = ["imessage", "whatsapp", "telegram"] as const;

export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

// The channels the receipts, links, bindings and outbox can record: since Lane B
// of host-telegram-channel, every channel the screens offer.
export type StoredChannel = MessagingChannel;

export function isMessagingChannel(value: unknown): value is MessagingChannel {
  return (MESSAGING_CHANNELS as readonly unknown[]).includes(value);
}

// The kind of device the screens run on (D7): Android has no iMessage; an
// iPhone, iPad or Mac has Messages; any other computer asks which app the host
// uses on their phone.
export type DeviceKind = "android" | "apple" | "other";

export function deviceKind(userAgent: string): DeviceKind {
  if (/Android/.test(userAgent)) return "android";
  // An iPad may report a Macintosh user agent; both have Messages.
  if (/iPhone|iPad|iPod|Macintosh/.test(userAgent)) return "apple";
  return "other";
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

// A bot username as Telegram allows it, and a start payload: up to 64 of
// A-Z a-z 0-9 _ - (host-telegram-channel design 6).
export const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const START_PAYLOAD = /^[A-Za-z0-9_-]{1,64}$/;

// Telegram's start link (D6): t.me/<bot>?start=<code>. On a phone it opens
// Telegram at the bot with Start, which sends /start <code> from the host's own
// account; on a computer it opens Telegram Desktop or Telegram Web, and the QR
// code carries the same URL.
export function telegramLinkFor(username: string, code: string) {
  const bot = username.replace(/^@/, "");
  if (!TELEGRAM_USERNAME.test(bot) || !START_PAYLOAD.test(code)) return null;
  return `https://t.me/${bot}?start=${code}`;
}

// What a deployment can link to, null where a channel is not configured: the
// iMessage line's number, the WhatsApp number as digits and the Telegram bot's
// username (TELEGRAM_BOT_USERNAME).
export type ConfiguredChannels = { readonly [Channel in MessagingChannel]: string | null };

// The configured channels in the order the screens list them.
export function configuredChannels(channels: ConfiguredChannels): MessagingChannel[] {
  return MESSAGING_CHANNELS.filter((channel) => Boolean(channels[channel]));
}

// The channels each device kind is offered, first channel first (D7): Android
// gets WhatsApp, else Telegram; an Apple device gets iMessage, then Telegram,
// then WhatsApp; another computer gets them all, by its host's answer.
const OFFERED: Readonly<Record<DeviceKind, readonly MessagingChannel[]>> = {
  android: ["whatsapp", "telegram"],
  apple: ["imessage", "telegram", "whatsapp"],
  other: ["imessage", "whatsapp", "telegram"],
};

function offered(device: DeviceKind, channels: ConfiguredChannels) {
  const list = OFFERED[device].filter((channel) => Boolean(channels[channel]));
  // A deployment whose only channel the device would not be offered still shows it.
  return list.length > 0 ? list : configuredChannels(channels);
}

// The channels "Which app do you use on your phone?" lists: every configured
// one. With one or none there is no question.
export function askChannels(channels: ConfiguredChannels) {
  return configuredChannels(channels);
}

// The channel a card or link step shows before any attempt exists (D7): the
// host's choice, else the device's first configured channel; null when another
// computer must first ask which app the host uses, or nothing is configured. An
// attempt or a binding names its own channel, which wins over this.
export function shownChannel(device: DeviceKind, channels: ConfiguredChannels, chosen: MessagingChannel | null = null): MessagingChannel | null {
  const list = offered(device, channels);
  if (list.length === 0) return null;
  if (chosen && channels[chosen]) return chosen;
  if (list.length === 1) return list[0]!;
  return device === "other" ? null : list[0]!;
}

// The other channels a device may switch to from `current`, each as "Use …
// instead" (D7): on Android the other of WhatsApp and Telegram; on an Apple
// device or another computer every other configured channel.
export function switchChannels(device: DeviceKind, channels: ConfiguredChannels, current: MessagingChannel): MessagingChannel[] {
  return offered(device, channels).filter((channel) => channel !== current);
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
