// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16
import { expect, test } from "vitest";
import { formatLocal, maskNumber, nationalDigits, reformat, validLocal } from "@/components/thyme/phone";

// Formats the number the way it looks after typing `typed` one character at a time.
function typed(cc: "+82" | "+1", text: string): string {
  let value = "";
  for (const ch of text) value = reformat(cc, value + ch, value.length + 1).value;
  return value;
}

test("Korean numbers get hyphens as they are typed", () => {
  expect(typed("+82", "10")).toBe("10");
  expect(typed("+82", "101")).toBe("10-1");
  expect(typed("+82", "101234")).toBe("10-1234");
  expect(typed("+82", "1012345")).toBe("10-1234-5");
  expect(typed("+82", "1012345678")).toBe("10-1234-5678");
  expect(typed("+82", "21234567")).toBe("2-123-4567");
  expect(typed("+82", "212345678")).toBe("2-1234-5678");
  expect(typed("+82", "311234567")).toBe("31-123-4567");
  expect(typed("+82", "3112345678")).toBe("31-1234-5678");
});

test("a leading 0 typed out of habit is dropped after +82", () => {
  expect(typed("+82", "01012345678")).toBe("10-1234-5678");
  expect(nationalDigits("+82", "010-1234-5678")).toBe("1012345678");
});

test("Korean numbers stop at 10 digits", () => {
  expect(typed("+82", "10123456789")).toBe("10-1234-5678");
});

test("US numbers are grouped 3-3-4", () => {
  expect(typed("+1", "2015550123")).toBe("201-555-0123");
});

test("other countries keep plain digits", () => {
  expect(formatLocal("+44", "7700900123")).toBe("7700900123");
});

test("the caret stays after the digit it followed when editing the middle", () => {
  // "10-1234-5678" with a 9 typed after "10-1"
  const result = reformat("+82", "10-19234-5678", 5);
  expect(result.value).toBe("10-1923-4567");
  expect(result.caret).toBe(5);
});

test("only mobile numbers are accepted", () => {
  expect(validLocal("+82", "1012345678")).toBe(true);
  expect(validLocal("+82", "212345678")).toBe(false);
  expect(validLocal("+82", "101234")).toBe(false);
  expect(validLocal("+1", "2015550123")).toBe(true);
  expect(validLocal("+1", "201555")).toBe(false);
});

test("the masked number shows only the last four digits", () => {
  expect(maskNumber("+82 10-9876-5432")).toBe("•••• 5432");
});
