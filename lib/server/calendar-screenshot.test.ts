import { describe, expect, it } from "vitest";
import { MAX_CALENDAR_IMAGE_BYTES } from "../contracts/calendar-screenshot";
import { validateCalendarImage } from "./calendar-screenshot";

function png() {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC", "base64");
}

describe("calendar screenshot validation", () => {
  it("accepts a complete PNG with dimensions", () => {
    expect(validateCalendarImage(png(), "image/png")).toEqual({ kind: "valid", type: "image/png" });
  });

  it("rejects a mismatched type, empty dimensions and unrelated bytes", () => {
    expect(validateCalendarImage(png(), "image/jpeg").kind).toBe("invalid");
    const empty = png();
    new DataView(empty.buffer, empty.byteOffset).setUint32(16, 0);
    expect(validateCalendarImage(empty, "image/png").kind).toBe("invalid");
    expect(validateCalendarImage(new Uint8Array(24), "image/png").kind).toBe("invalid");
    expect(validateCalendarImage(png().subarray(0, 24), "image/png").kind).toBe("invalid");
  });

  it("rejects an image over 10 MB before decoding it", () => {
    expect(validateCalendarImage(new Uint8Array(MAX_CALENDAR_IMAGE_BYTES + 1), "image/png").kind).toBe("too_large");
  });
});
