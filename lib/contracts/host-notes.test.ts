import { describe, expect, it } from "vitest";
import { cleanHostNotes, HOST_NOTES_MAX_LENGTH, hostNotesSchema, saveHostNotesInput } from "./host-notes";

// The host's notes for Thyme (host-preference-notes): free text, cleaned of
// characters that could hide or reorder what the guest's assistant reads.
describe("host notes", () => {
  it("keeps the host's words and line breaks", () => {
    expect(hostNotesSchema.parse("  투자 상담은 30분\r\nA first meeting is online.  ")).toBe("투자 상담은 30분\nA first meeting is online.");
  });

  it("removes control, zero-width and bidirectional-override characters", () => {
    expect(cleanHostNotes("first\u0000 meeting​ is‮ online⁦﻿")).toBe("first meeting is online");
    expect(cleanHostNotes("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("treats empty notes as none and refuses more than the limit", () => {
    expect(hostNotesSchema.parse("   ")).toBe("");
    expect(hostNotesSchema.safeParse("x".repeat(HOST_NOTES_MAX_LENGTH)).success).toBe(true);
    expect(hostNotesSchema.safeParse("x".repeat(HOST_NOTES_MAX_LENGTH + 1)).success).toBe(false);
  });

  it("takes only the notes", () => {
    expect(saveHostNotesInput.safeParse({ notes: "ok" }).success).toBe(true);
    expect(saveHostNotesInput.safeParse({ hostAccountId: "x", notes: "ok" }).success).toBe(false);
  });
});
