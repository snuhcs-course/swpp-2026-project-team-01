import { describe, expect, it } from "vitest";
import {
  handleBaseFromEmail,
  handleProblem,
  isUsableHandle,
  normalizeHandle,
  RESERVED_HANDLES,
} from "../contracts/handles";

// The handle contract every caller shares; assignment and its limits are covered
// against the database in tests/integration/handles.test.ts.

describe("handle format", () => {
  it("accepts lowercase letters, digits and single inner hyphens from 3 to 30 characters", () => {
    for (const handle of ["ada", "ada-lovelace", "a1b2", "x-1-y", "a".repeat(30)]) {
      expect(handleProblem(handle)).toBeNull();
    }
  });

  it("rejects a dot, a leading digit, a double or trailing hyphen, and a wrong length", () => {
    for (const handle of ["skill.md", "llms.txt", "_next", "1ada", "ada--l", "ada-", "-ada", "ab", "a".repeat(31), "ada l", "adá"]) {
      expect(handleProblem(handle)).toBe("format");
    }
  });

  it("checks the lower-cased handle, so Alice is alice", () => {
    expect(normalizeHandle("  Alice ")).toBe("alice");
    expect(handleProblem("Alice")).toBe("format");
    expect(isUsableHandle(normalizeHandle("Alice"))).toBe(true);
  });
});

describe("reserved handles", () => {
  it("reserves route and impersonation names", () => {
    for (const handle of ["app", "booking", "auth", "connect", "connections", "api", "eve", "support", "findmeatime", "sign-in", "well-known", "llms", "skill"]) {
      expect(handleProblem(handle)).toBe("reserved");
    }
  });

  it("holds exactly the design's 69 names, each a valid handle shape", () => {
    expect(RESERVED_HANDLES.size).toBe(69);
    for (const handle of RESERVED_HANDLES) expect(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(handle)).toBe(true);
  });
});

describe("handle base from an email address", () => {
  it("reduces the local part to the handle format", () => {
    expect(handleBaseFromEmail("Ada.Lovelace+cal@example.com")).toBe("ada-lovelace-cal");
    expect(handleBaseFromEmail("__42ada__@example.com")).toBe("ada");
    expect(handleBaseFromEmail("jo@example.com")).toBe("jox");
    expect(handleBaseFromEmail("7@example.com")).toBe("xxx");
  });

  it("leaves room for a numeric suffix", () => {
    const base = handleBaseFromEmail(`${"a".repeat(40)}@example.com`);
    expect(base.length).toBeLessThanOrEqual(26);
    expect(isUsableHandle(`${base}50`)).toBe(true);
  });
});
