import postgres from "postgres";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "./database";
import { authorizeSetupTool } from "./setup-tools";
import { captureContext, forgetContext, writeContext } from "./host-assistant-context";

const sql = vi.hoisted(() => {
  const query = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
  return Object.assign(query, { json: vi.fn<(value: unknown) => unknown>(), begin: vi.fn(async (fn: (tx: typeof query) => Promise<unknown>) => fn(query)) });
});
vi.mock("./database", () => ({ database: () => sql }));
vi.mock("./setup-tools", () => ({ authorizeSetupTool: vi.fn() }));
vi.mock("./channel-selection", () => ({ linkedMessagingTurn: async () => ({ inputId: "input", message: "[Telegram] avoid Fridays", channel: "telegram" }) }));
const driver = postgres("postgres://unused:unused@127.0.0.1:1/unused", { prepare: false });
function encodedValue(parameter: unknown): unknown {
  const parsed = z.object({ type: z.literal(3802), value: z.json() }).parse(parameter);
  return JSON.parse(String(driver.options.serializers[3802]!(parsed.value)));
}
function jsonParameter(args: readonly unknown[]) {
  return args.find(arg => typeof arg === "object" && arg !== null && "type" in arg && arg.type === 3802);
}
const call = { auth: { principalType: "user", principalId: "owner", attributes: { audience: "host_setup" } }, sessionId: "session", callId: "call" };
const entry = { kind: "memory", key: "fact", expectedRevision: 0, content: { memory: { text: "avoid Fridays", category: "soft_preference", expiresAt: null }, notice: "I'll remember: avoid Fridays" }, operationId: "turn:save" } satisfies Parameters<typeof writeContext>[3];
beforeEach(() => {
  vi.resetAllMocks();
  sql.json.mockImplementation(value => driver.json(z.record(z.string(), z.json()).parse(value)));
  sql.begin.mockImplementation(async fn => fn(sql));
  vi.mocked(authorizeSetupTool).mockResolvedValue({ id: "owner", kind: "host_account" });
});

describe("account context transactional writes", () => {
  it("encodes question, deferred and memory content once as JSONB objects", async () => {
    for (const item of [entry, { ...entry, kind: "question", content: { question: "Approve?", ref: "ABCDEF" } }, { ...entry, kind: "deferred", content: { text: "later" } }] satisfies Parameters<typeof writeContext>[3][]) {
      sql.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([{ revision: 1 }]);
      expect(await writeContext(database(), call, "scope", item)).toMatchObject({ saved: true });
      expect(encodedValue(jsonParameter(sql.mock.calls.at(-1)!))).toEqual(item.content);
    }
  });
  it("refuses stale revisions and forgotten-memory resurrection before any write", async () => {
    sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ revision: 2, operation_id: "old", forgotten_at: null }]);
    expect(await writeContext(database(), call, "scope", entry)).toMatchObject({ saved: false, problem: expect.stringContaining("stale_revision") });
    expect(sql).toHaveBeenCalledTimes(2);
    sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ revision: 1, operation_id: "turn:save", forgotten_at: new Date() }]);
    expect(await writeContext(database(), call, "scope", entry)).toEqual({ saved: false, revision: 1 });
    expect(sql).toHaveBeenCalledTimes(4);
  });
  it("deduplicates exact captures and keeps owner/scope plus revision checks on writes", async () => {
    sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ revision: 1, operation_id: "turn:save", forgotten_at: null }]);
    expect(await writeContext(database(), call, "scope", entry)).toEqual({ saved: true, revision: 1 });
    sql.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([{ revision: 1 }]);
    expect(await writeContext(database(), call, "other-scope", entry)).toEqual({ saved: true, revision: 1 });
    const write = sql.mock.calls.at(-1)!;
    expect(String(write[0])).toContain("where app.host_assistant_context.revision =");
    expect(write).toContain("owner");
    expect(write).toContain("other-scope");
  });
  it("commits memory only when the completed assistant reply includes the one-line notice", async () => {
    const row = { ...entry, entry_key: "fact", revision: 1, confirmed: false, operation_id: "turn:save", source_input_id: "input" };
    sql.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ entry_key: "capture" }]).mockResolvedValueOnce([]);
    await captureContext(database(), call, "scope", "capture-id", [{ role: "assistant", content: "I'll remember: avoid Fridays" }], "turn");
    expect(sql.mock.calls.at(-1)).toContain(true);
    expect(encodedValue(jsonParameter(sql.mock.calls.at(-1)!))).toEqual(entry.content);
    sql.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ entry_key: "capture2" }]).mockResolvedValueOnce([]);
    await captureContext(database(), call, "scope", "capture-id2", [{ role: "assistant", content: "Anything else?" }], "turn");
    expect(sql.mock.calls.at(-1)).toContain(false);
    expect(encodedValue(jsonParameter(sql.mock.calls.at(-1)!))).toEqual({});
  });
  it("a delayed capture confirms only its original turn and never a later question", async () => {
    const old = { ...entry, kind: "memory", entry_key: "old-fact", revision: 1, confirmed: false, operation_id: "old-turn:save", source_input_id: "old-input" };
    const newer = { kind: "question", entry_key: "latest", revision: 2, confirmed: false, content: { question: "New question?" }, operation_id: "new-turn:question", source_input_id: "new-input" };
    sql.mockResolvedValueOnce([old, newer]).mockResolvedValueOnce([{ entry_key: "captured" }]).mockResolvedValueOnce([]);
    await captureContext(database(), call, "scope", "delayed-capture", [{ role: "assistant", content: "I'll remember: avoid Fridays" }], "old-turn");
    expect(sql).toHaveBeenCalledTimes(3);
    expect(sql.mock.calls.at(-1)).toContain("old-fact");
    expect(sql.mock.calls.at(-1)).not.toContain("latest");
    expect(sql.mock.calls[1]).toContain("old-input");
  });
  it("does nothing when a capture operation has already been recorded", async () => {
    sql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await captureContext(database(), call, "scope", "capture-id", [{ role: "assistant", content: "old" }], "turn");
    expect(sql).toHaveBeenCalledTimes(2);
  });
  it("clears a forgotten record only at its observed revision and denies deletion-era writes", async () => {
    sql.mockResolvedValueOnce(Object.assign([], { count: 1 }));
    expect(await forgetContext(database(), call, "scope", "fact", 3, "memory")).toEqual({ forgotten: true });
    expect(sql.mock.calls[0]).toContain(3);
    vi.mocked(authorizeSetupTool).mockRejectedValue(new Error("deleted account"));
    await expect(writeContext(database(), call, "scope", entry)).rejects.toThrow("deleted account");
    expect(sql).toHaveBeenCalledTimes(1);
  });
});
