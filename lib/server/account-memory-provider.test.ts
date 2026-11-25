import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryTurnStartedContext } from "eve/memory";
import { accountMemoryProvider } from "../../agent/memory/account";
import { authorizeSetupTool } from "./setup-tools";
import { accountSnapshot, captureContext, contextAuthority, readContext } from "./host-assistant-context";

vi.mock("./setup-tools", async importOriginal => ({ ...await importOriginal<typeof import("./setup-tools")>(), authorizeSetupTool: vi.fn() }));
vi.mock("./setup", () => ({ setupDependenciesFromEnvironment: () => ({ db: "test-db" }) }));
vi.mock("./database", () => ({ database: () => "test-db" }));
vi.mock("./host-assistant-context", async importOriginal => ({
  ...await importOriginal<typeof import("./host-assistant-context")>(),
  contextAuthority: vi.fn(), accountSnapshot: vi.fn(), captureContext: vi.fn(), readContext: vi.fn(),
}));
const ctx: MemoryTurnStartedContext = {
  abortSignal: new AbortController().signal, messages: [], operationId: "recall-one",
  turn: { id: "turn-one", input: [{ role: "user", content: "What's next?" }], sequence: 1 },
  memory: { slot: "account", scope: { key: "scoped-key", namespace: "private", value: "owner" } },
  session: { id: "session", auth: { current: { principalId: "owner", principalType: "user", authenticator: "test", attributes: { audience: "host_setup" } }, initiator: null }, turn: { id: "turn-one", sequence: 1 } },
  async getSandbox() { throw new Error("No sandbox access for account memory"); },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authorizeSetupTool).mockResolvedValue({ id: "owner", kind: "host_account" });
  vi.mocked(contextAuthority).mockResolvedValue({ actor: { id: "owner", kind: "host_account" }, turn: { inputId: "input", message: "[Telegram] hello", channel: "telegram" } });
  vi.mocked(readContext).mockResolvedValue([]);
});
describe("account custom memory provider lifecycle", () => {
  it("uses three stable replacement ids and reloads state after compaction", async () => {
    const snapshot: Awaited<ReturnType<typeof accountSnapshot>> = {
      current: { now: "now", thisWeek: "this", nextWeek: "next" }, timezone: "UTC", setupStep: "ready", bookings: [], sent: [], note: "navigation",
      pending: [{ ref: "A", version: 1, revision: 2, request_id: "request-a", state: "awaiting_host_approval", proposed: null }],
    };
    vi.mocked(accountSnapshot).mockResolvedValue(snapshot);
    const first = await accountMemoryProvider.recall["turn.started"](ctx);
    expect(first.messages.map(row => row.id)).toEqual(["state", "ledger", "private-memory"]);
    expect(first.messages[0]!.content).toContain('"version":1');
    snapshot.pending = [];
    const next = await accountMemoryProvider.recall["compaction.completed"]({ ...ctx, operationId: "recall-two" });
    expect(next.messages[0]!.content).toContain('"pending":[]');
    expect(next.messages[2]!.content).toContain('"memories":[]');
    expect(captureContext).not.toHaveBeenCalled();
    expect(readContext).toHaveBeenCalledWith("test-db", "owner", "scoped-key");
  });
  it("captures settled turns with the stable operation id but never ingests compaction text", async () => {
    await accountMemoryProvider.capture["turn.completed"]({ ...ctx, operationId: "capture-one" });
    expect(captureContext).toHaveBeenCalledExactlyOnceWith("test-db", expect.objectContaining({ sessionId: "session" }), "scoped-key", "capture-one", [], "turn-one");
    await accountMemoryProvider.capture["compaction.requested"]({ ...ctx, operationId: "compact", compaction: { modelId: "test", usageInputTokens: 1000 } });
    expect(captureContext).toHaveBeenCalledTimes(1);
  });
  it("fails closed for revoked authority or a mismatched scope", async () => {
    await expect(accountMemoryProvider.recall["turn.started"]({ ...ctx, memory: { ...ctx.memory, scope: { ...ctx.memory.scope, value: "other" } } })).rejects.toThrow("scope mismatch");
    expect(readContext).not.toHaveBeenCalled();
    vi.mocked(authorizeSetupTool).mockRejectedValue(new Error("deleted account"));
    await expect(accountMemoryProvider.recall["turn.started"](ctx)).rejects.toThrow("deleted account");
    expect(readContext).not.toHaveBeenCalled();
  });
});
