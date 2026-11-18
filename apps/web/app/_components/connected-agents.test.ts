import type { ImessageStatus } from "@lib/contracts/imessage";
import { expect, test } from "vitest";
import { HOST_GRANT_SOURCE, listedMessagingChannels } from "./connected-agents";

test("Connected apps tells a host how to connect or switch agents with this origin's SKILL.md (testing baseline A01 M-4.1)", () => {
  const hint = HOST_GRANT_SOURCE.connectHint?.("https://release.findmeatime.com");
  expect(hint?.prompt).toContain("https://release.findmeatime.com/SKILL.md");
  expect(hint?.note).toMatch(/revoke the old one/);
});

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
