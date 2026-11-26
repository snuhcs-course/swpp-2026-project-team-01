import { describe, expect, it } from "vitest";
import { closeNoticeText, type StoredOption } from "./group-close";
import { groupTermsProblem, hashGroupToken, isGroupToken } from "./group-meetings";

// The host's close message and the group terms (group-scheduling).

const group = { purpose: "킥오프", timezone: "Asia/Seoul" };

function option(position: number, overrides: Partial<StoredOption> = {}): StoredOption {
  return {
    end: new Date(`2026-11-0${position + 1}T07:00:00Z`),
    missing: [],
    mode: "in_person",
    place: "강남역",
    position,
    start: new Date(`2026-11-0${position + 1}T06:00:00Z`),
    ...overrides,
  };
}

describe("the host's close message", () => {
  it("lists the first three options and offers more", () => {
    const text = closeNoticeText(group, 4, [option(1), option(2, { mode: "online", place: null }), option(3), option(4)], "ko");

    expect(text).toContain("4명이 답했어요");
    expect(text).toContain("모두 가능한 시간");
    expect(text).toContain("1. ");
    expect(text).toContain("온라인 (Google Meet)");
    expect(text).not.toContain("4. ");
    expect(text).toContain("더 필요하면");
  });

  it("names who cannot make each option when none fits everyone", () => {
    const text = closeNoticeText(group, 4, [option(1, { missing: ["Ada"] })], "en");

    expect(text).toContain("No time works for everyone");
    expect(text).toContain("Ada can't make it");
    expect(text).not.toContain("Ask if you'd like more");
  });

  it("says when nothing was found", () => {
    expect(closeNoticeText(group, 2, [], "en")).toContain("could not find a time");
  });
});

describe("group terms", () => {
  it("refuses a reversed, too long or past range", () => {
    expect(groupTermsProblem({ rangeEnd: "2026-11-30", rangeStart: "2026-11-27" }, "2026-11-26")).toBeNull();
    expect(groupTermsProblem({ rangeEnd: "2026-11-27", rangeStart: "2026-11-30" }, "2026-11-26")).toBe("range_reversed");
    expect(groupTermsProblem({ rangeEnd: "2027-01-30", rangeStart: "2026-11-27" }, "2026-11-26")).toBe("range_too_long");
    expect(groupTermsProblem({ rangeEnd: "2026-11-20", rangeStart: "2026-11-19" }, "2026-11-26")).toBe("range_past");
  });

  it("looks a shared link up by its hash only", () => {
    const token = "a".repeat(43);
    expect(isGroupToken(token)).toBe(true);
    expect(isGroupToken("short")).toBe(false);
    expect(hashGroupToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGroupToken(token)).not.toContain(token);
  });
});
