import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Contrast of the ink token pairs DESIGN.md documents, read from the shipped
// stylesheet so a token change cannot silently break them.

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const declared = new Map([...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));

function token(name: string): string {
  const value = declared.get(name);
  if (!value) throw new Error(`--${name} is not declared on :root`);
  const reference = /^var\(--([\w-]+)\)$/.exec(value);
  return reference ? token(reference[1]!) : value;
}

function luminance(hex: string) {
  const channels = hex
    .replace("#", "")
    .match(/../g)!
    .map((pair) => parseInt(pair, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(foreground: string, background: string) {
  const [lighter, darker] = [luminance(token(foreground)), luminance(token(background))].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("ink theme contrast", () => {
  it("keeps the ratios DESIGN.md documents for the flat token pairs", () => {
    expect(contrast("foreground", "background")).toBeCloseTo(14.51, 2);
    expect(contrast("muted-foreground", "background")).toBeCloseTo(5.82, 2);
    expect(contrast("muted-foreground", "secondary")).toBeCloseTo(5.17, 2);
    expect(contrast("primary-foreground", "primary")).toBeCloseTo(10.63, 2);
    expect(contrast("logo", "background")).toBeCloseTo(6.06, 2);
    for (const status of ["destructive", "warning", "success"]) {
      expect(contrast(status, "background")).toBeGreaterThan(6);
    }
  });

  it("keeps the ratios DESIGN.md documents on the ink-blue panel and the ink night", () => {
    expect(contrast("canvas", "panel")).toBeCloseTo(9.91, 2);
    expect(contrast("panel-mist", "panel")).toBeCloseTo(6.71, 2);
    expect(contrast("canvas", "panel-bubble")).toBeCloseTo(7.86, 2);
    expect(contrast("ink", "panel-me")).toBeCloseTo(12.07, 2);
    expect(contrast("canvas", "night")).toBeCloseTo(14.51, 2);
    expect(contrast("night-muted", "night")).toBeCloseTo(7.36, 2);
    expect(contrast("night-accent", "night")).toBeCloseTo(6.58, 2);
    expect(contrast("canvas", "night-raise")).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["foreground", "card"],
    ["foreground", "popover"],
    ["foreground", "secondary"],
    ["foreground", "accent"],
    ["foreground", "panel-me"],
    ["muted-foreground", "card"],
    ["muted-foreground", "secondary"],
    ["primary", "background"],
    ["primary", "card"],
    ["primary", "secondary"],
    ["primary-foreground", "primary-hover"],
    ["primary-foreground", "primary-pressed"],
    ["primary-foreground", "destructive"],
  ])("gives normal text %s on %s at least 4.5:1", (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["ring", "background"],
    ["ring", "card"],
    ["input", "background"],
    ["input", "card"],
  ])("gives the essential boundary %s on %s at least 3:1", (boundary, background) => {
    expect(contrast(boundary, background)).toBeGreaterThanOrEqual(3);
  });

  it("keeps the decorative hairline and slate line out of text roles", () => {
    // Too faint for text or as an interactive control's only boundary.
    expect(contrast("border", "background")).toBeLessThan(3);
    expect(contrast("botanical", "background")).toBeLessThan(4.5);
    for (const role of ["foreground", "muted-foreground", "card-foreground", "primary"]) {
      expect(["border", "botanical"].map((name) => token(name))).not.toContain(token(role));
    }
  });

  it("draws no paper grain", () => {
    expect(css).not.toMatch(/grain/i);
  });
});
