import { describe, expect, it } from "vitest";
import { confirmSettingsCommand, updateDraftCommand } from "./setup-commands";

describe("setup command inputs", () => {
  const update = (input: unknown) => updateDraftCommand.input.safeParse(input).success;

  it("takes no value for Use this and requires one for Adjust and Choose my own", () => {
    expect(update({ action: "use_suggestion", field: "durationMinutes" })).toBe(true);
    expect(update({ action: "use_suggestion", field: "durationMinutes", value: 45 })).toBe(false);
    expect(update({ action: "adjust", field: "durationMinutes", value: 45 })).toBe(true);
    expect(update({ action: "choose_own", field: "durationMinutes" })).toBe(false);
  });

  it("refuses unknown fields, extra keys and a foreign browser zone", () => {
    expect(update({ action: "adjust", field: "accepted", value: true })).toBe(false);
    expect(update({ accepted: true, action: "adjust", field: "durationMinutes", value: 45 })).toBe(false);
    expect(update({ action: "use_suggestion", browserTimeZone: "Mars/Olympus", field: "timezone" })).toBe(false);
    expect(update({ action: "use_suggestion", browserTimeZone: "Asia/Seoul", field: "timezone" })).toBe(true);
  });

  it("confirms only a reviewed proposal hash", () => {
    const confirm = confirmSettingsCommand([], "https://findmeatime.com");

    expect(confirm.input.safeParse({ proposalHash: "a".repeat(64) }).success).toBe(true);
    expect(confirm.input.safeParse({ proposalHash: "not-a-hash" }).success).toBe(false);
    expect(confirm.input.safeParse({}).success).toBe(false);
  });
});
