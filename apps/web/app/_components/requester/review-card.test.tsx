import { describe, expect, it } from "vitest";
import { findsTimes } from "./request-cards";

describe("findsTimes", () => {
  // #241: the card finds times when the server says the applied request is
  // ready, never from its own view of the request.
  it("follows the apply result's findTimes", () => {
    expect(findsTimes({ findTimes: true, revision: 3, state: "gathering" })).toBe(true);
    expect(findsTimes({ findTimes: false, revision: 3, state: "gathering" })).toBe(false);
  });

  it("finds nothing for a result without the answer", () => {
    expect(findsTimes({ revision: 3, state: "gathering" })).toBe(false);
    expect(findsTimes(null)).toBe(false);
    expect(findsTimes(undefined)).toBe(false);
  });
});
