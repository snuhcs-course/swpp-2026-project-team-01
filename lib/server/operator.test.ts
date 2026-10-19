import { describe, expect, it } from "vitest";
import { adminSql, AdminUsageError, parseAdminArguments, runAdmin, sqlLiteral } from "./operator";

// Argument validation and SQL building for fmat-admin; the database and transport
// paths are covered in tests/integration/operator.test.ts.

const base = ["--operator", "ops", "--local"];

describe("fmat-admin arguments", () => {
  it("parses a mutation with one environment", () => {
    expect(parseAdminArguments(["suspend", "--host", "Alice", "--reason", "spam", "--operator", "ops", "--project", "abcdefghijklmnopqrst", "--yes"])).toEqual({
      command: "suspend",
      host: "alice",
      operator: "ops",
      reason: "spam",
      target: { kind: "project", ref: "abcdefghijklmnopqrst" },
      yes: true,
    });
  });

  it.each([
    [["show", "--host", "alice", "--operator", "ops"], /exactly one environment/],
    [["show", "--host", "alice", "--operator", "ops", "--local", "--project", "abcdefghijklmnopqrst"], /exactly one environment/],
    [["show", "--host", "alice", "--operator", "ops", "--project", "ABC'; drop"], /project ref/],
    [["show", "--host", "x'; drop table app.host_accounts; --", ...base], /host account ID or a valid handle/],
    [["show", "--host", "app", ...base], /valid handle/],
    [["show", ...base], /valid handle/],
    [["suspend", "--host", "alice", ...base], /--reason is required/],
    [["suspend", "--host", "alice", "--reason", "x".repeat(501), ...base], /at most 500/],
    [["suspend", "--host", "alice", "--reason", "a\u0000b", ...base], /control characters/],
    [["show", "--host", "alice", "--operator", "o".repeat(101), "--local"], /at most 100/],
    [["delete", "--host", "alice", ...base], /one command/],
    [["show", "--host", "alice", "--unknown", ...base], /Unknown option/],
  ])("refuses %j", (argv, message) => {
    expect(() => parseAdminArguments(argv)).toThrow(AdminUsageError);
    expect(() => parseAdminArguments(argv)).toThrow(message);
  });

  it("accepts a host account ID in any case", () => {
    expect(parseAdminArguments(["show", "--host", "0B9A4C1E-1111-4222-8333-944455556666", ...base]).host).toBe(
      "0b9a4c1e-1111-4222-8333-944455556666",
    );
  });
});

describe("fmat-admin SQL", () => {
  it("quotes literals by doubling single quotes", () => {
    expect(sqlLiteral("O'Neil's")).toBe("'O''Neil''s'");
  });

  it("calls the operator function with every value quoted", () => {
    const sql = adminSql(parseAdminArguments(["restore", "--host", "alice", "--reason", "appeal o'k", "--operator", "Dana O'Hara", "--local"]));

    expect(sql).toContain("app.operator_set_host_status('alice', 'active', 'Dana O''Hara', 'appeal o''k', 'local')");
  });

  it("reads status, handle and readiness for show", () => {
    const sql = adminSql(parseAdminArguments(["show", "--host", "alice", ...base]));

    expect(sql).toContain("where handle = 'alice' and released_at is null");
    expect(sql).toContain("'https://www.googleapis.com/auth/calendar.events' = any (g.granted_scopes)");
    expect(sql).not.toContain("operator_set_host_status");
  });
});

describe("fmat-admin runner", () => {
  function capture(interactive = false, answer = "") {
    const out: string[] = [];
    const err: string[] = [];
    return {
      deps: {
        env: { DATABASE_URL: "postgresql://postgres:postgres@db.example.supabase.co:5432/postgres" },
        interactive,
        prompt: async () => answer,
        stderr: (line: string) => err.push(line),
        stdout: (line: string) => out.push(line),
      },
      err,
      out,
    };
  }

  it("prints usage named fmat-admin", async () => {
    const { deps, out } = capture();
    expect(await runAdmin([], deps)).toBe(2);
    expect(out.join("\n")).toMatch(/^fmat-admin/);
  });

  it("refuses a mutation without --yes when no one can confirm", async () => {
    const { deps, err } = capture(false);
    expect(await runAdmin(["suspend", "--host", "alice", "--reason", "spam", ...base], deps)).toBe(1);
    expect(err.join("\n")).toMatch(/without --yes/);
  });

  it("refuses a mismatched typed confirmation", async () => {
    const { deps, err } = capture(true, "bob");
    expect(await runAdmin(["suspend", "--host", "alice", "--reason", "spam", ...base], deps)).toBe(1);
    expect(err.join("\n")).toMatch(/did not match/);
  });

  it("refuses --local when DATABASE_URL is not the local stack", async () => {
    const { deps, err } = capture();
    expect(await runAdmin(["show", "--host", "alice", ...base], deps)).toBe(1);
    expect(err.join("\n")).toMatch(/not the local stack/);
  });
});
