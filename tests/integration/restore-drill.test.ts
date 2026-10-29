import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { compareFingerprints, containerName, RESTORED, runDrill, SOURCE, tableFingerprints } from "../../scripts/restore-drill";
import { testDatabase } from "./support/database";

// The backup restoration drill (data-stewardship: backup restoration drill) on
// the local stack: the synthetic backup restores into its own database and
// matches the source, the comparison notices a changed table, and the local
// database never receives the synthetic rows.

const db = testDatabase();
const container = containerName(readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8"));

function dropDrill() {
  for (const database of [SOURCE, RESTORED]) {
    execFileSync("docker", ["exec", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-qc", `drop database if exists ${database} with (force)`]);
  }
}

afterAll(async () => {
  dropDrill();
  await db.end();
});

describe("restore drill", () => {
  it("restores the synthetic backup into an isolated database that matches it, and notices a change", { timeout: 180_000 }, async () => {
    const lines: string[] = [];

    expect(runDrill({ keep: true, log: (line) => lines.push(line) })).toBe(true);
    expect(lines.at(-2)).toBe("Restore drill passed.");
    expect(lines.join("\n")).not.toMatch(/drill-host-\d+@example\.test|Drill Requester/);

    const [local] = await db<{ count: number }[]>`select count(*)::int as count from app.host_handles where handle like 'drill-host-%'`;
    expect(local!.count).toBe(0);

    const source = tableFingerprints(container, SOURCE);
    execFileSync("docker", ["exec", container, "psql", "-U", "supabase_admin", "-d", RESTORED, "-qc", "delete from app.command_outcomes where retry_key = 'retry-1'"]);
    expect(compareFingerprints(source, tableFingerprints(container, RESTORED))).toEqual(["app.command_outcomes"]);
  });
});
