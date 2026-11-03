import { CHANNEL_MARKERS, CHANNEL_NAMES, MESSAGING_CHANNELS, type MessagingChannel } from "@lib/contracts/messaging-channel";
import type { EveMessage } from "eve/react";

// Which channel each message of a host discussion came through. A linked
// iMessage or WhatsApp shares the discussion with /app, and its forwarded text
// is stored with a marker (host-imessage-channel D11); /app shows those
// messages on their own tab (D20). A reply belongs to the channel of the host
// message it answers.

export type MessageChannel = "web" | MessagingChannel;

export type ChannelEntry = {
  readonly channel: MessageChannel;
  // The position in the whole discussion, so streaming still marks the last message.
  readonly index: number;
  // The message as shown: a forwarded message without its marker.
  readonly message: EveMessage;
};

function markedChannel(message: EveMessage): MessagingChannel | null {
  if (message.role !== "user") return null;
  const first = message.parts.find((part) => part.type === "text");
  if (first?.type !== "text") return null;
  return MESSAGING_CHANNELS.find((channel) => first.text.startsWith(CHANNEL_MARKERS[channel])) ?? null;
}

function unmarked(message: EveMessage, marker: string): EveMessage {
  const first = message.parts.findIndex((part) => part.type === "text");
  return {
    ...message,
    parts: message.parts.map((part, index) =>
      index === first && part.type === "text" ? { ...part, text: part.text.slice(marker.length) } : part,
    ),
  };
}

export function splitByChannel(messages: readonly EveMessage[]): ChannelEntry[] {
  let current: MessageChannel = "web";

  return messages.map((message, index) => {
    if (message.role !== "user") return { channel: current, index, message };
    const marked = markedChannel(message);
    current = marked ?? "web";
    return { channel: current, index, message: marked ? unmarked(message, CHANNEL_MARKERS[marked]) : message };
  });
}

// The messaging channels a discussion has messages from, in the order they first appear.
export function messagingChannels(entries: readonly ChannelEntry[]): MessagingChannel[] {
  const seen: MessagingChannel[] = [];
  for (const entry of entries) {
    if (entry.channel !== "web" && !seen.includes(entry.channel)) seen.push(entry.channel);
  }
  return seen;
}

// The tab label for a discussion's messaging channels; a host who switched
// channels sees both on one tab.
export function messagingLabel(channels: readonly MessagingChannel[]) {
  return channels.map((channel) => CHANNEL_NAMES[channel]).join(" & ");
}
