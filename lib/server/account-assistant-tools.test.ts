import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "./database";
import { accountRequestCall, accountSentCall, decideAccountRequests, pendingQuestionMatches, unqualifiedAnswer } from "./account-assistant-tools";
import { authorizeSetupTool } from "./setup-tools";
import { channelOfTurn } from "./channel-selection";
import { listHostRequests } from "./host-requests";
import { listSentRequests } from "./host-sent-requests";
import { runCommand } from "./commands";
import { requestRef } from "./request-ref";
import type { HostRequestItem } from "../contracts/host-request";

vi.mock("./setup-tools", async importOriginal => ({ ...await importOriginal<typeof import("./setup-tools")>(), authorizeSetupTool: vi.fn() }));
vi.mock("./channel-selection", async importOriginal => ({ ...await importOriginal<typeof import("./channel-selection")>(), channelOfTurn: vi.fn() }));
vi.mock("./host-requests", () => ({ listHostRequests: vi.fn(), readHostRequest: vi.fn() }));
vi.mock("./host-sent-requests", () => ({ listSentRequests: vi.fn() }));
vi.mock("./commands", async importOriginal => ({ ...await importOriginal<typeof import("./commands")>(), runCommand: vi.fn() }));
const db = createDatabase("postgres://unused:unused@127.0.0.1:1/unused");
const owner = "ed498360-13dd-47b6-bde4-cf8efa687ea8";
const call = { auth: { principalType: "user", principalId: owner, attributes: { audience: "host_setup" } }, callId: "turn-call", sessionId: "account-session" };
const a = "cd498360-13dd-47b6-bde4-cf8efa687ea8";
const b = "bd498360-13dd-47b6-bde4-cf8efa687ea8";
const item = (id: string, name: string): HostRequestItem => ({ requestId: id, requesterName: name, purpose: null, state: "awaiting_host_approval", sample: false, needsDecision: true, bookedStart: null, proposalStart: null, updatedAt: "2026-11-26T00:00:00Z" });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authorizeSetupTool).mockResolvedValue({ id: owner, kind: "host_account" });
  vi.mocked(channelOfTurn).mockResolvedValue("telegram");
  vi.mocked(listHostRequests).mockResolvedValue([item(a, "Eunwoo"), item(b, "Dohyeon")]);
  vi.mocked(runCommand).mockResolvedValue({ ok: true, result: { state: "reserved" }, replayed: false, correlationId: "test" });
});

describe("account assistant refs and independent decisions", () => {
  it("resolves any owned ref without changing session authority", async () => {
    expect(await accountRequestCall(db, call, requestRef(b))).toEqual({ ...call, requestId: b });
    expect(listHostRequests).toHaveBeenCalledWith(db, owner, { limit: null });
    await expect(accountRequestCall(db, call, "Woo")).rejects.toThrow("ambiguous");
    await expect(accountRequestCall(db, call, "foreign-ref")).rejects.toThrow("unavailable");
    vi.mocked(channelOfTurn).mockResolvedValue(null);
    await expect(accountRequestCall(db, call, requestRef(a))).rejects.toThrow();
  });
  it("executes clear siblings in one call and returns a result even for an ambiguous item", async () => {
    vi.mocked(listHostRequests).mockResolvedValue([item(a, "Eunwoo"), item(b, "Dohyeon"), item(owner, "Dohyeon")]);
    const output = await decideAccountRequests(db, call, { items: [
      { ref: "Dohyeon", action: "decline", version: 1, expectedRevision: 2 },
      { ref: "Eunwoo", action: "approve", version: 1, expectedRevision: 2 },
    ] });
    expect(output.results).toHaveLength(2);
    expect(output.results[0]!.result).toMatchObject({ problem: expect.stringContaining("ambiguous") });
    expect(output.results[1]!.result).toMatchObject({ ok: true });
    expect(runCommand).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ operation: "account.decide_request" }), expect.objectContaining({ resourceId: a, expectedRevision: 2, retryKey: "tool:turn-call:1" }));
  });
  it("retains the unique awaiting-approval match among several requests with the exact same name", async () => {
    vi.mocked(listHostRequests).mockResolvedValue([item(a, "Eunwoo"), { ...item(b, "Eunwoo"), state: "gathering" }]);
    expect(await accountRequestCall(db, call, "Eunwoo", "approve")).toMatchObject({ requestId: a });
    await expect(accountRequestCall(db, call, "Eunwoo", "decline")).rejects.toThrow("ambiguous");
  });
  it("keeps stale/failed item results independent and retains stable retry identities", async () => {
    const input = { items: [{ ref: "Eunwoo", action: "approve", version: 1, expectedRevision: 2 }, { ref: "Dohyeon", action: "cancel", version: 3, expectedRevision: 7 }] } satisfies Parameters<typeof decideAccountRequests>[2];
    vi.mocked(runCommand).mockResolvedValueOnce({ ok: false, error: { category: "stale_revision", message: "changed", correlationId: "stale" } });
    const output = await decideAccountRequests(db, call, input);
    expect(output.results[0]!.result).toMatchObject({ ok: false, error: { category: "stale_revision" } });
    expect(output.results[1]!.result).toMatchObject({ ok: true });
    await decideAccountRequests(db, call, input);
    expect(vi.mocked(runCommand).mock.calls.map(args => args[2].retryKey)).toEqual(["tool:turn-call:0", "tool:turn-call:1", "tool:turn-call:0", "tool:turn-call:1"]);
    expect(output.note).toContain("not confirmed booked");
  });
  it("resolves sent refs only from verified account associations", async () => {
    vi.mocked(listSentRequests).mockResolvedValue([{ requestId: a, hostName: "Other host", purpose: null, state: "negotiating", proposalStart: null, bookedStart: null, updatedAt: "now" }]);
    expect(await accountSentCall(db, call, requestRef(a))).toEqual({ ...call, requesterRequestId: a });
    await expect(accountSentCall(db, call, b)).rejects.toThrow("unavailable");
    expect(listSentRequests).toHaveBeenCalledWith(db, owner, null);
  });
  it("binds yes to the ledger's direction, ref, action and current version/revision", () => {
    const question = { question: "Approve Eunwoo's?", direction: "received", ref: requestRef(a), version: 2, expectedRevision: 3, decision: "approve" };
    expect(pendingQuestionMatches(question, "received", requestRef(a), 2, 3, "approve")).toBe(true);
    expect(pendingQuestionMatches(question, "received", requestRef(b), 2, 3, "approve")).toBe(false);
    expect(pendingQuestionMatches(question, "received", requestRef(a), 3, 3, "approve")).toBe(false);
    expect(pendingQuestionMatches(question, "received", requestRef(a), 2, 4, "approve")).toBe(false);
    expect(pendingQuestionMatches(question, "received", requestRef(a), 2, 3, "decline")).toBe(false);
    expect(pendingQuestionMatches(question, "sent", requestRef(a), 2, 3)).toBe(false);
    expect(pendingQuestionMatches(null, "received", requestRef(a), 2, 3)).toBe(false);
  });
  it("recognizes an unqualified yes but never a conditional answer", () => {
    for (const message of ["[Telegram] yes", "네", "[WhatsApp] 👍"]) expect(unqualifiedAnswer(message)).toBe(true);
    for (const message of ["yes, but at 11", "네 근데 내일로", "approve Eunwoo's", "what next?"]) expect(unqualifiedAnswer(message)).toBe(false);
  });
});
