import { describe, expect, it } from "vitest";
import { AGENT_LIMITS, admitAttempt, AttemptLimitError, registrationBounds, tokenBounds } from "./agent-limits";
import type { Database } from "./database";

// An in-memory app.agent_protocol_attempts that answers the four statements
// admitAttempt runs: the advisory lock, the cleanup, the window count and the
// insert. It keeps rows across calls, as the table does.
function attemptsTable() {
  const rows: { kind: string; keyHash: string; createdAt: Date }[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes("pg_advisory_xact_lock") || sql.includes("delete from")) return Promise.resolve([]);
    if (sql.includes("select count(*)")) {
      const [kind, keyHash, windowSeconds] = values as [string, string, number];
      const since = Date.now() - windowSeconds * 1000;
      const counted = rows.filter((row) => row.kind === kind && row.keyHash === keyHash && row.createdAt.getTime() > since);
      const oldest = counted.length ? new Date(Math.min(...counted.map((row) => row.createdAt.getTime()))) : null;
      return Promise.resolve([{ count: counted.length, oldest }]);
    }
    if (sql.includes("insert into")) {
      const [kind, keyHash] = values as [string, string];
      rows.push({ createdAt: new Date(), keyHash, kind });
      return Promise.resolve([]);
    }
    throw new Error(`Unexpected statement: ${sql}`);
  };
  return { begin: (run: (transaction: typeof tx) => Promise<unknown>) => run(tx) } as unknown as Database;
}

async function admitted(db: Database, kind: "registration" | "token", bounds: ReturnType<typeof tokenBounds>) {
  try {
    await admitAttempt(db, kind, bounds);
    return true;
  } catch (error) {
    if (error instanceof AttemptLimitError) return false;
    throw error;
  }
}

const CLAUDE_CLIENT = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CLAUDE_EGRESS = "source-hash-of-a-shared-egress";

describe("token bounds", () => {
  it("does not cap everyone who shares a metadata document client ID and an egress address at one client's bound", async () => {
    const db = attemptsTable();
    // More people than the former bound of 60 per client per minute, each
    // redeeming or refreshing their own credential.
    for (let person = 0; person < 200; person += 1) {
      expect(await admitted(db, "token", tokenBounds({ clientId: CLAUDE_CLIENT, credential: `refresh-${person}`, source: CLAUDE_EGRESS }))).toBe(true);
    }
  });

  it("still bounds repeated attempts with one credential", async () => {
    const db = attemptsTable();
    const bounds = tokenBounds({ clientId: CLAUDE_CLIENT, credential: "one-refresh-token", source: CLAUDE_EGRESS });
    for (let attempt = 0; attempt < AGENT_LIMITS.tokenPerCredential.limit; attempt += 1) expect(await admitted(db, "token", bounds)).toBe(true);
    expect(await admitted(db, "token", bounds)).toBe(false);

    // Another person's credential under the same client is unaffected.
    expect(await admitted(db, "token", tokenBounds({ clientId: CLAUDE_CLIENT, credential: "another-refresh-token", source: CLAUDE_EGRESS }))).toBe(true);
  });

  it("bounds one source across credentials and client IDs", async () => {
    const db = attemptsTable();
    for (let attempt = 0; attempt < AGENT_LIMITS.tokenPerSource.limit; attempt += 1) {
      expect(await admitted(db, "token", tokenBounds({ clientId: `client-${attempt}`, credential: `guess-${attempt}`, source: "one-source" }))).toBe(true);
    }
    expect(await admitted(db, "token", tokenBounds({ clientId: "client-next", credential: "guess-next", source: "one-source" }))).toBe(false);
    expect(await admitted(db, "token", tokenBounds({ clientId: "client-next", credential: "guess-next", source: "another-source" }))).toBe(true);
  });
});

describe("registration bounds", () => {
  it("leaves a shared egress room beyond the former 10 per hour and still bounds it", async () => {
    const db = attemptsTable();
    expect(AGENT_LIMITS.registrationPerSource.limit).toBeGreaterThan(10);
    for (let index = 0; index < AGENT_LIMITS.registrationPerSource.limit; index += 1) {
      expect(await admitted(db, "registration", registrationBounds(CLAUDE_EGRESS))).toBe(true);
    }
    expect(await admitted(db, "registration", registrationBounds(CLAUDE_EGRESS))).toBe(false);
    expect(await admitted(db, "registration", registrationBounds("another-source"))).toBe(true);
  });

  it("keeps the service-wide bound across sources", () => {
    expect(registrationBounds("a").find((entry) => entry.bound === AGENT_LIMITS.registrationService)?.key).toBe(
      registrationBounds("b").find((entry) => entry.bound === AGENT_LIMITS.registrationService)?.key,
    );
  });
});
