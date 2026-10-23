import { describe, expect, it } from "vitest";
import { AdminUsageError } from "./operator-shared";
import { parseRecoveryArguments, recoverySql } from "./recovery-operations";

// Argument validation and SQL building for the recover commands; the database
// paths are in tests/integration/recovery-operations.test.ts.

const local = ["--operator", "ops", "--local"];
const id = "0b9a4c1e-1111-4222-8333-944455556666";

describe("fmat-admin recover arguments", () => {
  it("parses a job recovery on a project with an uppercase ID", () => {
    expect(
      parseRecoveryArguments(["recover", "job", "--job", id.toUpperCase(), "--attempts", "10", "--reason", "provider outage", "--operator", "ops", "--project", "abcdefghijklmnopqrst", "--yes"]),
    ).toEqual({
      attempts: 10,
      command: "job",
      operator: "ops",
      reason: "provider outage",
      subject: id,
      target: { kind: "project", ref: "abcdefghijklmnopqrst" },
      yes: true,
    });
  });

  it.each([
    [["recover", ...local], /one recover command/],
    [["recover", "email", ...local], /one recover command/],
    [["recover", "job", "--job", id, "--reason", "r", "--operator", "ops"], /exactly one environment/],
    [["recover", "job", "--job", "x'; drop table app.jobs; --", "--reason", "r", ...local], /must be an ID/],
    [["recover", "job", "--job", id, ...local], /--reason is required/],
    [["recover", "job", "--job", id, "--reason", "r", "--attempts", "11", ...local], /from 1 to 10/],
    [["recover", "job", "--job", id, "--reason", "r", "--attempts", "0", ...local], /from 1 to 10/],
    [["recover", "job", "--booking", id, "--reason", "r", ...local], /takes no --booking/],
    [["recover", "booking", "--booking", id, "--reason", "r", "--attempts", "2", ...local], /takes no --attempts/],
    [["recover", "booking", "--booking", id, "--reason", "a\u0007b", ...local], /control characters/],
    [["recover", "booking", "--reason", "r", ...local], /--booking must be an ID/],
  ])("refuses %j", (argv, message) => {
    expect(() => parseRecoveryArguments(argv)).toThrow(AdminUsageError);
    expect(() => parseRecoveryArguments(argv)).toThrow(message);
  });

  it("builds each statement with quoted literals and the claiming worker's environment", () => {
    expect(recoverySql(parseRecoveryArguments(["recover", "job", "--job", id, "--reason", "O'Neil's outage", ...local]))).toContain(
      `app.operator_requeue_job('${id}'::uuid, 3, 'ops', 'O''Neil''s outage', 'local')`,
    );
    expect(
      recoverySql(parseRecoveryArguments(["recover", "booking", "--booking", id, "--reason", "lost", "--operator", "ops", "--project", "abcdefghijklmnopqrst"])),
    ).toContain(`app.operator_reconcile_booking('${id}'::uuid, 'production', 'ops', 'lost', 'project:abcdefghijklmnopqrst')`);
    expect(recoverySql(parseRecoveryArguments(["recover", "booking", "--booking", id, "--reason", "lost", ...local]))).toContain(
      `'${id}'::uuid, 'local', 'ops'`,
    );
  });
});
