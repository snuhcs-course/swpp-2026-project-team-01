import type { ImessageStatus } from "@lib/contracts/imessage";
import { expect, test } from "vitest";
import { listedMessagingChannels } from "./connected-agents";

const channels = { imessage: "+15550001111", telegram: "findmeatime_bot", whatsapp: null };

test("Connected apps lists only the channels this deployment offers, so hidden WhatsApp is left out (issue #221)", () => {
  expect(listedMessagingChannels({ channels, lineNumber: "+15550001111", state: "none" })).toEqual(["imessage", "telegram"]);
});

test("a host still linked to WhatsApp sees it, even while WhatsApp is not offered", () => {
  const status = { channel: "whatsapp", channels, contactCard: null, delivery: null, lineNumber: "", linkedAt: "2026-11-16T00:00:00Z", sender: "+82 10-****-1234", state: "linked" } as ImessageStatus;
  expect(listedMessagingChannels(status)).toEqual(["imessage", "whatsapp", "telegram"]);
});

test("nothing is listed before the status loads or while messaging is unavailable", () => {
  expect(listedMessagingChannels(null)).toEqual([]);
  expect(listedMessagingChannels({ state: "unavailable" })).toEqual([]);
});
