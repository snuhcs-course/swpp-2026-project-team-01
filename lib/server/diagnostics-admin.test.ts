import { describe, expect, it } from "vitest";
import { diagnosticsSql, parseDiagnosticsArguments } from "./diagnostics-admin";
import { AdminUsageError } from "./operator-shared";

// Argument validation and SQL building for the diagnostics commands; the
// database paths are in tests/integration/diagnostics.test.ts.

const local = ["--operator", "ops", "--local"];

describe("fmat-admin diagnostics arguments", () => {
  it("parses a snapshot with its default sample size", () => {
    expect(parseDiagnosticsArguments(["diagnostics", "snapshot", ...local])).toEqual({
      command: "snapshot",
      json: false,
      operator: "ops",
      samples: 20,
      target: { kind: "local" },
    });
  });

  it("parses rejections on a project as JSON", () => {
    expect(parseDiagnosticsArguments(["diagnostics", "rejections", "--json", "--operator", "ops", "--project", "abcdefghijklmnopqrst"])).toMatchObject({
      command: "rejections",
      json: true,
      target: { kind: "project", ref: "abcdefghijklmnopqrst" },
    });
  });

  it.each([
    [["diagnostics", ...local], /one diagnostics command/],
    [["diagnostics", "usage", "--by", "month", ...local], /day or week/],
    [["diagnostics", "usage", "--periods", "91", ...local], /from 1 to 90/],
    [["diagnostics", "usage", "--by", "week", "--periods", "53", ...local], /from 1 to 52/],
    [["diagnostics", "usage", "--until", "2026-02-30", ...local], /YYYY-MM-DD/],
    [["diagnostics", "usage", "--until", "2026-11-01'; drop", ...local], /YYYY-MM-DD/],
    [["diagnostics", "usage", "--samples", "3", ...local], /takes no --samples/],
    [["diagnostics", "snapshot", "--by", "day", ...local], /takes no --by/],
    [["diagnostics", "dump", ...local], /one diagnostics command/],
    [["diagnostics", "snapshot", "--operator", "ops"], /exactly one environment/],
    [["diagnostics", "snapshot", "--operator", "ops", "--project", "ABC'; drop"], /project ref/],
    [["diagnostics", "snapshot", "--samples", "21", ...local], /from 1 to 20/],
    [["diagnostics", "snapshot", "--samples", "0", ...local], /from 1 to 20/],
    [["diagnostics", "snapshot", "--samples", "3; drop", ...local], /from 1 to 20/],
    [["diagnostics", "snapshot", "--reason", "x", ...local], /Unknown option/],
    [["diagnostics", "rejections", "--samples", "3", ...local], /takes no --samples/],
    [["diagnostics", "snapshot", "--local"], /--operator is required/],
  ])("refuses %j", (argv, message) => {
    expect(() => parseDiagnosticsArguments(argv)).toThrow(AdminUsageError);
    expect(() => parseDiagnosticsArguments(argv)).toThrow(message);
  });

  it("builds one read-only statement per command", () => {
    expect(diagnosticsSql(parseDiagnosticsArguments(["diagnostics", "snapshot", "--samples", "5", ...local]))).toBe(
      "select app.operator_diagnostics_snapshot(5) as snapshot",
    );
    expect(diagnosticsSql(parseDiagnosticsArguments(["diagnostics", "rejections", ...local]))).toBe(
      "select app.operator_rejection_snapshot() as snapshot",
    );
    expect(diagnosticsSql(parseDiagnosticsArguments(["diagnostics", "usage", ...local]))).toBe(
      "select app.operator_channel_usage_report('day', 14, null::date) as snapshot",
    );
    expect(diagnosticsSql(parseDiagnosticsArguments(["diagnostics", "usage", "--by", "week", "--until", "2026-11-23", ...local]))).toBe(
      "select app.operator_channel_usage_report('week', 8, '2026-11-23'::date) as snapshot",
    );
  });

  it("parses a usage report with its defaults and options", () => {
    expect(parseDiagnosticsArguments(["diagnostics", "usage", ...local]).usage).toEqual({ by: "day", periods: 14, until: null });
    expect(
      parseDiagnosticsArguments(["diagnostics", "usage", "--by", "week", "--periods", "52", "--until", "2024-02-29", ...local]).usage,
    ).toEqual({ by: "week", periods: 52, until: "2024-02-29" });
  });
});
