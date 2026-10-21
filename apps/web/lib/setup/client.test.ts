import { afterEach, describe, expect, it, vi } from "vitest";
import { createRetryKeys, runSetupCommand } from "./client";

// Retry identity and outcome classification for setup card commands.

describe("retry keys", () => {
  it("keeps the keys for a retry of the same intent and makes new ones for a new intent", () => {
    let next = 0;
    const keys = createRetryKeys(() => `key-${(next += 1)}`);

    expect(keys.keysFor("save-roles", 1)).toEqual(["key-1"]);
    expect(keys.keysFor("save-roles", 1)).toEqual(["key-1"]);
    expect(keys.keysFor("use-duration", 3)).toEqual(["key-2", "key-3", "key-4"]);
    expect(keys.keysFor("save-roles", 1)).toEqual(["key-5"]);
  });

  it("starts fresh after the intent settles", () => {
    let next = 0;
    const keys = createRetryKeys(() => `key-${(next += 1)}`);

    keys.keysFor("confirm", 1);
    keys.settle();
    expect(keys.keysFor("confirm", 1)).toEqual(["key-2"]);
  });
});

describe("runSetupCommand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = { expectedRevision: 3, input: { proposalHash: "a".repeat(64) }, operation: "setup.confirm_settings", retryKey: "k" } as const;

  it("returns the result of a completed command", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ correlationId: "c", ok: true, replayed: true, result: { revision: 4 } })));
    expect(await runSetupCommand(request)).toEqual({ kind: "ok", replayed: true, result: { revision: 4 } });
  });

  it("reports a refused command with its category, so nothing is retried with the same key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { category: "stale_revision", correlationId: "c", message: "This changed since you last saw it." }, ok: false },
          { status: 409 },
        ),
      ),
    );
    expect(await runSetupCommand(request)).toEqual({
      code: "stale_revision",
      kind: "refused",
      message: "This changed since you last saw it.",
    });
  });

  it("keeps a refusal's reason, so a lost booking destination can ask for a writable one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: { category: "invalid_input", correlationId: "c", message: "The request is not valid.", reason: "destination_not_writable" },
            ok: false,
          },
          { status: 400 },
        ),
      ),
    );
    expect(await runSetupCommand(request)).toEqual({
      code: "invalid_input",
      kind: "refused",
      message: "The request is not valid.",
      reason: "destination_not_writable",
    });
  });

  it("sends Use this with the shown value and no browser zone", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ correlationId: "c", ok: true, replayed: false, result: {} }));
    vi.stubGlobal("fetch", fetch);
    const use = {
      expectedRevision: 2,
      input: { action: "use_suggestion", field: "meetingMode", shown: "online" },
      operation: "setup.update_draft",
      retryKey: "k",
    } as const;
    await runSetupCommand(use);

    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual(use);
  });

  it("reports a route refusal outside the command pipeline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "calendar_access_revoked", error: "Google Calendar access was revoked." }, { status: 409 })),
    );
    expect(await runSetupCommand(request)).toMatchObject({ code: "calendar_access_revoked", kind: "refused" });
  });

  it("treats a lost or unreadable response as uncertain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect((await runSetupCommand(request)).kind).toBe("uncertain");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })));
    expect((await runSetupCommand(request)).kind).toBe("uncertain");
  });

  it("sends the operation, expected revision, retry key and input", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ correlationId: "c", ok: true, replayed: false, result: {} }));
    vi.stubGlobal("fetch", fetch);
    await runSetupCommand(request);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/setup/commands");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });
});
