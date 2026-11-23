import { describe, expect, it } from "vitest";
import { parseCommand, requestRef, reviewRef, settingsRef } from "./imessage-commands";

// Exact iMessage commands (host-imessage-channel design 8, D8): the whole
// message, trimmed and compared case-insensitively, is a command; anything else,
// "yes" included, is free text for the assistant.

describe("parseCommand", () => {
  it("recognizes the bare and referenced commands", () => {
    expect(parseCommand("help")).toEqual({ name: "help" });
    expect(parseCommand("  Review ")).toEqual({ name: "review" });
    expect(parseCommand("REQUESTS")).toEqual({ name: "requests" });
    expect(parseCommand("request k7q2mx")).toEqual({ name: "request", ref: "K7Q2MX" });
    expect(parseCommand("approve K7Q2MX-3")).toEqual({ name: "approve", ref: "K7Q2MX-3" });
    expect(parseCommand("decline k7q2mx-3")).toEqual({ name: "decline", ref: "K7Q2MX-3" });
    expect(parseCommand("share K7Q2MX-S2")).toEqual({ name: "share", ref: "K7Q2MX-S2" });
    expect(parseCommand("confirm 1a2b3c4d")).toEqual({ name: "confirm", ref: "1A2B3C4D" });
  });

  it("reads stop and unlink as stop (host-whatsapp-channel D12)", () => {
    expect(parseCommand("STOP")).toEqual({ name: "stop" });
    expect(parseCommand(" unlink ")).toEqual({ name: "stop" });
    expect(parseCommand("stop sending me these")).toBeNull();
  });

  it("accepts Telegram's leading slash and bot mention (host-telegram-channel design 8)", () => {
    expect(parseCommand("/requests")).toEqual({ name: "requests" });
    expect(parseCommand("/Review@findmeatime_bot")).toEqual({ name: "review" });
    expect(parseCommand("/approve@findmeatime_bot k7q2mx-3")).toEqual({ name: "approve", ref: "K7Q2MX-3" });
    expect(parseCommand("/stop")).toEqual({ name: "stop" });
    // A linked host tapping Start again gets help; /start <code> is linking, read before commands.
    expect(parseCommand("/start")).toEqual({ name: "help" });
    expect(parseCommand("start")).toBeNull();
    for (const text of ["/approve", "/yes", "requests@findmeatime_bot", "/requests@someone", "/requests @findmeatime_bot", "//requests"]) {
      expect(parseCommand(text)).toBeNull();
    }
  });

  it("leaves everything else to the assistant", () => {
    for (const text of ["yes", "Yes, approve it", "approve", "approve it please", "review the proposal", "ok", "approve K7Q2MX-3 now", "help me"]) {
      expect(parseCommand(text)).toBeNull();
    }
  });
});

describe("decline with other dates (decline-with-unavailable-dates, #58)", () => {
  it("reads up to 14 YYYY-MM-DD dates after the reference, once each", () => {
    expect(parseCommand("decline k7q2mx-3 2026-12-03 2026-12-05")).toEqual({ dates: ["2026-12-03", "2026-12-05"], name: "decline", ref: "K7Q2MX-3" });
    expect(parseCommand("Decline K7Q2MX-3 2026-12-03 2026-12-03")).toEqual({ dates: ["2026-12-03"], name: "decline", ref: "K7Q2MX-3" });
    expect(parseCommand("/decline@findmeatime_bot k7q2mx-3 2026-12-03")).toEqual({ dates: ["2026-12-03"], name: "decline", ref: "K7Q2MX-3" });
    const fourteen = Array.from({ length: 14 }, (_, index) => `2026-12-${String(index + 1).padStart(2, "0")}`);
    expect(parseCommand(`decline K7Q2MX-3 ${fourteen.join(" ")}`)).toMatchObject({ dates: fourteen });
  });

  it("leaves anything else after the reference to the assistant, so a reason is never a command", () => {
    const fifteen = Array.from({ length: 15 }, (_, index) => `2026-12-${String(index + 1).padStart(2, "0")}`);
    for (const text of [
      `decline K7Q2MX-3 ${fifteen.join(" ")}`,
      "decline K7Q2MX-3 2026-12-03 because I travel",
      "decline K7Q2MX-3 Dec 3",
      "decline K7Q2MX-3 2026-02-30",
      "decline K7Q2MX-3 2026-12-3",
      "approve K7Q2MX-3 2026-12-03",
      "share K7Q2MX-S2 2026-12-03",
    ]) {
      expect(parseCommand(text)).toBeNull();
    }
  });
});

describe("references", () => {
  it("derive six Crockford characters from the request ID, and name versions and reviews", () => {
    const id = "6f1c8f0e-2a3b-4c5d-8e9f-0a1b2c3d4e5f";
    expect(requestRef(id)).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(requestRef(id)).toBe(requestRef(id));
    expect(requestRef(id)).not.toBe(requestRef("6f1c8f0e-2a3b-4c5d-8e9f-0a1b2c3d4e60"));
    expect(reviewRef(id, 3)).toBe(`${requestRef(id)}-3`);
    expect(settingsRef("abcdef0123456789".repeat(4))).toBe("ABCDEF01");
  });
});
