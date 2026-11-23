import { describe, expect, it } from "vitest";
import { deletionSql, parseDeletionArguments } from "./data-deletion";
import { AdminUsageError } from "./operator-shared";

// Argument validation and SQL building for deletion on request; the database
// paths are in tests/integration/data-stewardship.test.ts.

const local = ["--operator", "ops", "--local"];
const id = "0b9a4c1e-1111-4222-8333-944455556666";

describe("fmat-admin deletion arguments", () => {
  it("parses a host by handle and a request by ID", () => {
    expect(parseDeletionArguments(["delete-host", "--host", "Alice", "--reason", "asked by email", ...local])).toEqual({
      command: "delete-host",
      operator: "ops",
      reason: "asked by email",
      subject: "alice",
      target: { kind: "local" },
      yes: false,
    });
    expect(parseDeletionArguments(["delete-request", "--request", id.toUpperCase(), "--reason", "r", ...local, "--yes"]).subject).toBe(id);
  });

  it.each([
    [["delete", "--host", "alice", "--reason", "r", ...local], /delete-host or delete-request/],
    [["delete-host", "--host", "alice", "--reason", "r", "--operator", "ops"], /exactly one environment/],
    [["delete-host", "--host", "x'; drop table app.host_accounts; --", "--reason", "r", ...local], /host account ID, a valid handle or a Google address/],
    [["delete-host", "--host", "app", "--reason", "r", ...local], /valid handle/],
    [["delete-host", "--host", "alice", ...local], /--reason is required/],
    [["delete-host", "--host", "alice", "--request", id, "--reason", "r", ...local], /takes no --request/],
    [["delete-request", "--request", "not-an-id", "--reason", "r", ...local], /must be an ID/],
    [["delete-request", "--request", id, "--host", "alice", "--reason", "r", ...local], /takes no --host/],
  ])("refuses %j", (argv, message) => {
    expect(() => parseDeletionArguments(argv)).toThrow(AdminUsageError);
    expect(() => parseDeletionArguments(argv)).toThrow(message);
  });

  it("takes a guest account's Google address, lower-cased", () => {
    const request = parseDeletionArguments(["delete-host", "--host", "Guest.Name@Example.com", "--reason", "asked by email", ...local]);
    expect(request.subject).toBe("guest.name@example.com");
    expect(deletionSql(request)).toContain(
      "app.operator_delete_host(coalesce((select g.host_account_id::text from app.google_identities g join app.host_accounts a on a.id = g.host_account_id where lower(g.email) = 'guest.name@example.com' order by a.deleted_at is null desc, a.created_at desc limit 1), 'guest.name@example.com'), 'ops', 'asked by email', 'local')",
    );
    expect(() => parseDeletionArguments(["delete-host", "--host", "a'b@example.com", "--reason", "r", ...local])).toThrow(/Google address/);
    expect(() => parseDeletionArguments(["delete-host", "--host", "nobody@", "--reason", "r", ...local])).toThrow(/Google address/);
  });

  it("builds each statement with quoted literals", () => {
    expect(deletionSql(parseDeletionArguments(["delete-host", "--host", "alice", "--reason", "O'Neil asked", ...local]))).toContain(
      "app.operator_delete_host('alice', 'ops', 'O''Neil asked', 'local')",
    );
    expect(deletionSql(parseDeletionArguments(["delete-request", "--request", id, "--reason", "r", ...local]))).toContain(
      `app.operator_delete_request('${id}'::uuid, 'ops', 'r', 'local')`,
    );
  });
});
