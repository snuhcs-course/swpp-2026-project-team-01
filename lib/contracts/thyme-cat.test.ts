import { describe, expect, it } from "vitest";
import { type CatPart, catOfParts, catsOfThread, thymeCatPath } from "./thyme-cat";

const text: CatPart = { type: "text" };

function tool(toolName: string, state: string, values: { input?: unknown; output?: unknown } = {}): CatPart {
  return { state, toolName, type: "dynamic-tool", ...values };
}

const agreed = tool("agree_to_proposal", "output-available", { input: { version: 2 }, output: { recorded: true, state: "awaiting_host_approval" } });
const refused = tool("agree_to_proposal", "output-available", { input: { version: 2 }, output: { recorded: false, message: "Nothing was agreed" } });
const booked = tool("read_booking_status", "output-available", { output: { state: "booked" } });
const waiting = tool("read_booking_status", "output-available", { output: { state: "awaiting_host_approval" } });
const failed = tool("read_request", "output-error");
const askedHappy = tool("show_cat", "output-available", { input: { cat: "happy" }, output: { shown: "happy" } });
const ownedMistake = tool("show_cat", "output-available", { input: { cat: "sorry" }, output: { shown: "sorry" } });

describe("Thyme's cat for a message", () => {
  it("is happy when an agreement was recorded or the meeting is booked", () => {
    expect(catOfParts([agreed, text])).toEqual({ cat: "happy", requested: false });
    expect(catOfParts([booked, text])).toEqual({ cat: "happy", requested: false });
  });

  it("is none for a refused agreement, a meeting not yet booked or plain text", () => {
    expect(catOfParts([refused, text])).toBeNull();
    expect(catOfParts([waiting, text])).toBeNull();
    expect(catOfParts([text])).toBeNull();
  });

  it("is sorry when a tool failed or the assistant owned a mistake, before a recorded happy", () => {
    expect(catOfParts([failed, text])).toEqual({ cat: "sorry", requested: false });
    expect(catOfParts([ownedMistake, text])).toEqual({ cat: "sorry", requested: false });
    expect(catOfParts([agreed, failed, text])).toEqual({ cat: "sorry", requested: false });
  });

  it("is the happy cat the guest asked for, before anything else", () => {
    expect(catOfParts([failed, askedHappy, text])).toEqual({ cat: "happy", requested: true });
  });

  it("ignores a show_cat call that has not finished or failed", () => {
    expect(catOfParts([tool("show_cat", "input-available", { input: { cat: "happy" } })])).toBeNull();
    expect(catOfParts([tool("show_cat", "output-error", { input: { cat: "sorry" } })])).toBeNull();
  });

  it("reads the tool name eve records when it has one", () => {
    const named: CatPart = { ...agreed, toolMetadata: { eve: { name: "agree_to_proposal" } }, toolName: "tool_7" };
    expect(catOfParts([named])).toEqual({ cat: "happy", requested: false });
  });
});

describe("Thyme's cats in a thread", () => {
  const thyme = (...parts: CatPart[]) => ({ parts, role: "assistant" });
  const guest = { parts: [text], role: "user" };

  it("does not repeat the previous Thyme message's cat", () => {
    expect(catsOfThread([thyme(agreed), guest, thyme(booked), guest, thyme(booked)])).toEqual(["happy", null, null, null, "happy"]);
  });

  it("shows a different cat right after", () => {
    expect(catsOfThread([thyme(agreed), guest, thyme(failed)])).toEqual(["happy", null, "sorry"]);
  });

  it("repeats the happy cat when the guest asked for it", () => {
    expect(catsOfThread([thyme(askedHappy), guest, thyme(askedHappy)])).toEqual(["happy", null, "happy"]);
  });

  it("points at the blue drawings", () => {
    expect(thymeCatPath("happy")).toBe("/thyme/blue-happy-256.png");
    expect(thymeCatPath("sorry", 128)).toBe("/thyme/blue-sorry-128.png");
  });
});
