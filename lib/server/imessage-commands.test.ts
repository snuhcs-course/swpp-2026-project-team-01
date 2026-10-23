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

  it("leaves everything else to the assistant", () => {
    for (const text of ["yes", "Yes, approve it", "approve", "approve it please", "review the proposal", "ok", "approve K7Q2MX-3 now", "help me"]) {
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
