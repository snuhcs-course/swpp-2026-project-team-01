import { describe, expect, it } from "vitest";
import { personLine } from "./booking";

describe("personLine", () => {
  it("names the person with the address", () => {
    expect(personLine("Ada Lovelace", "ada@example.test")).toBe("Ada Lovelace <ada@example.test>");
  });

  it("shows the address once when Google returns no name or the name is the address", () => {
    expect(personLine(null, "ada@example.test")).toBe("ada@example.test");
    expect(personLine("  ", "ada@example.test")).toBe("ada@example.test");
    expect(personLine("ADA@example.test", "ada@example.test")).toBe("ada@example.test");
  });

  it("shows the name alone without an address", () => {
    expect(personLine("Ada Lovelace", null)).toBe("Ada Lovelace");
  });
});
