import { describe, expect, it, vi } from "vitest";
import type { Database } from "./database";
import { observeRejection, REJECTION_CATEGORIES, rejectionCollectionEnabled } from "./diagnostics";

// The bounded rejection collection's categorization and failure handling; the
// stored counts are covered in tests/integration/diagnostics.test.ts.

function fakeDb(result: () => Promise<unknown>) {
  const calls: unknown[][] = [];
  const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push([strings.join("?"), ...values]);
    return result();
  }) as unknown as Database;
  return { calls, db };
}

const enabled = { DIAGNOSTICS_REJECTIONS: "1" };

describe("rejection collection", () => {
  it("maps only the recognized categories", () => {
    expect(REJECTION_CATEGORIES).toEqual({
      forbidden: "authorization_denied",
      request_closed: "stale_action",
      stale_revision: "stale_action",
      unauthenticated: "authorization_denied",
    });
  });

  it.each([
    ["forbidden", "authorization_denied"],
    ["unauthenticated", "authorization_denied"],
    ["stale_revision", "stale_action"],
    ["request_closed", "stale_action"],
  ] as const)("sends only the category for %s", async (category, observed) => {
    const { calls, db } = fakeDb(async () => []);
    await observeRejection(db, category, enabled);
    expect(calls).toEqual([["select app.record_rejection(?)", observed]]);
  });

  it.each(["invalid_input", "internal", "rate_limited", "retry_conflict", "booking_pending"] as const)(
    "records nothing for %s",
    async (category) => {
      const { calls, db } = fakeDb(async () => []);
      await observeRejection(db, category, enabled);
      expect(calls).toEqual([]);
    },
  );

  it("records nothing unless explicitly enabled", async () => {
    const { calls, db } = fakeDb(async () => []);
    for (const env of [{}, { DIAGNOSTICS_REJECTIONS: "true" }, { DIAGNOSTICS_REJECTIONS: "0" }]) {
      expect(rejectionCollectionEnabled(env)).toBe(false);
      await observeRejection(db, "forbidden", env);
    }
    expect(calls).toEqual([]);
  });

  it("swallows a storage failure", async () => {
    const { db } = fakeDb(async () => {
      throw new Error("relation app.rejection_observations does not exist; secret=abc");
    });
    await expect(observeRejection(db, "forbidden", enabled)).resolves.toBeUndefined();
  });

  it("stops waiting at its bound when storage hangs", async () => {
    vi.useFakeTimers();
    try {
      const { db } = fakeDb(() => new Promise(() => {}));
      const observed = observeRejection(db, "stale_revision", enabled, 500);
      await vi.advanceTimersByTimeAsync(500);
      await expect(observed).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
