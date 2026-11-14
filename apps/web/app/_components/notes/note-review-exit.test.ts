import type { ImessageStatus } from "@lib/contracts/imessage";
import { describe, expect, it } from "vitest";
import { noteReviewExit } from "./note-review-exit";

function linked(channel: "imessage" | "whatsapp" | "telegram", lineNumber: string): ImessageStatus {
  return {
    channel,
    channels: { imessage: "+15550001111", telegram: "findmeatime_bot", whatsapp: "15550002222" },
    contactCard: null,
    delivery: null,
    lineNumber,
    linkedAt: "2026-11-13T00:00:00.000Z",
    sender: "•••• 1234",
    state: "linked",
  };
}

describe("noteReviewExit", () => {
  it("opens the chat the host set up in", () => {
    expect(noteReviewExit(linked("imessage", "+15550001111"), "ios")).toEqual({ channel: "imessage", href: "sms:+15550001111" });
    expect(noteReviewExit(linked("imessage", "+15550001111"), "android")).toEqual({ channel: "imessage", href: "sms:+15550001111" });
    expect(noteReviewExit(linked("whatsapp", "15550002222"), "other")).toEqual({ channel: "whatsapp", href: "https://wa.me/15550002222" });
    expect(noteReviewExit(linked("telegram", "findmeatime_bot"), "other")).toEqual({ channel: "telegram", href: "https://t.me/findmeatime_bot" });
  });

  it("goes to the workspace without a linked chat, or where Messages cannot open", () => {
    expect(noteReviewExit({ channels: { imessage: null, telegram: null, whatsapp: null }, lineNumber: "", state: "none" }, "ios")).toEqual({ channel: null, href: "/app" });
    expect(noteReviewExit(null, "ios")).toEqual({ channel: null, href: "/app" });
    // A Windows computer has no Messages app to open.
    expect(noteReviewExit(linked("imessage", "+15550001111"), "other")).toEqual({ channel: null, href: "/app" });
  });
});
