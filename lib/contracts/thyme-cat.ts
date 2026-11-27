// Thyme's cats (thyme-mood-cats): the happy or sorry cat that may end a Thyme
// message on the guest's web conversation, like the mark that ends a magazine
// piece. Browser-safe: the web chooses the cat from the message's own tool
// parts, so it never says more than the records do (D3).
//
// - happy: the guest asked for it (show_cat happy), the guest's agreement was
//   recorded (agree_to_proposal recorded: true), or read_booking_status
//   reported the meeting booked.
// - sorry: a tool call ended in an error, or the assistant owned a mistake
//   (show_cat sorry). A refusal returned as an output (recorded: false) is not
//   a mistake and brings no cat (D5).
//
// One cat per message, in the order of D6, and never the previous Thyme
// message's cat again unless the guest asked for it.

import { z } from "zod";

export const THYME_CATS = ["happy", "sorry"] as const;
export type ThymeCat = (typeof THYME_CATS)[number];

export const SHOW_CAT_TOOL = "show_cat";
export const showCatToolInput = z.object({ cat: z.enum(THYME_CATS) });

// The drawings exist for the blue cat only, whatever THYME_AVATAR picks.
export function thymeCatPath(cat: ThymeCat, size: 128 | 256 = 256) {
  return `/thyme/blue-${cat}-${size}.png`;
}

// The 512px WEBP Telegram fetches for sendSticker after a guest's reply (D7).
export function thymeStickerPath(cat: ThymeCat) {
  return `/thyme/blue-${cat}-sticker.webp`;
}

// The shape of a message part this needs, so it does not depend on eve's types.
export type CatPart = {
  readonly type: string;
  readonly toolName?: string;
  readonly toolMetadata?: { readonly eve?: { readonly name?: string } };
  readonly state?: string;
  readonly input?: unknown;
  readonly output?: unknown;
};

function toolNameOf(part: CatPart) {
  const name = part.toolMetadata?.eve?.name;
  return name && name !== "unknown" ? name : part.toolName;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

// The cat a message's parts ask for on their own, before the no-repeat rule:
// requested is true when it came from show_cat happy.
export function catOfParts(parts: readonly CatPart[]): { readonly cat: ThymeCat; readonly requested: boolean } | null {
  let askedHappy = false;
  let sorry = false;
  let recordedHappy = false;

  for (const part of parts) {
    if (part.type !== "dynamic-tool") continue;
    const name = toolNameOf(part);
    if (part.state === "output-error") {
      if (name !== SHOW_CAT_TOOL) sorry = true;
      continue;
    }
    if (part.state !== "output-available") continue;
    if (name === SHOW_CAT_TOOL) {
      const cat = field(part.input, "cat");
      if (cat === "happy") askedHappy = true;
      if (cat === "sorry") sorry = true;
    } else if (name === "agree_to_proposal" && field(part.output, "recorded") === true) {
      recordedHappy = true;
    } else if (name === "read_booking_status" && field(part.output, "state") === "booked") {
      recordedHappy = true;
    }
  }

  if (askedHappy) return { cat: "happy", requested: true };
  if (sorry) return { cat: "sorry", requested: false };
  if (recordedHappy) return { cat: "happy", requested: false };
  return null;
}

// Each Thyme message's cat in thread order; other messages get null and do
// not break the run, so the rule compares Thyme's messages only.
export function catsOfThread(messages: readonly { readonly role: string; readonly parts: readonly CatPart[] }[]): (ThymeCat | null)[] {
  let previous: ThymeCat | null = null;
  return messages.map((message) => {
    if (message.role !== "assistant") return null;
    const found = catOfParts(message.parts);
    const cat = found && (found.requested || found.cat !== previous) ? found.cat : null;
    previous = cat;
    return cat;
  });
}
