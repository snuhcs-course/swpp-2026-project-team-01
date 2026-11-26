import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "./database";
import { readAccountSentAccess } from "./account-requests";
import { channelOfTurn } from "./channel-selection";
import { authorizeSetupTool } from "./setup-tools";
import { authorizeRequestTool, RequestToolDeniedError } from "./request-tools";

vi.mock("./account-requests", async importOriginal => ({ ...await importOriginal<typeof import("./account-requests")>(), readAccountSentAccess: vi.fn() }));
vi.mock("./channel-selection", async importOriginal => ({ ...await importOriginal<typeof import("./channel-selection")>(), channelOfTurn: vi.fn() }));
vi.mock("./setup-tools", async importOriginal => ({ ...await importOriginal<typeof import("./setup-tools")>(), authorizeSetupTool: vi.fn() }));
const owner = "4f1c7a52-2b8e-4a36-9b1d-0e6a7d1f2c33";
const target = "9b2f3c1e-0a4d-4f6b-8c7e-1d2a3b4c5d6e";
const db = createDatabase("postgres://unused:unused@127.0.0.1:1/unused");
const call = { auth: { principalType: "user", principalId: owner, attributes: { audience: "host_setup" } }, sessionId: "account-session", requesterRequestId: target };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authorizeSetupTool).mockResolvedValue({ id: owner, kind: "host_account" });
  vi.mocked(channelOfTurn).mockResolvedValue("telegram");
  vi.mocked(readAccountSentAccess).mockResolvedValue({ host_account_id: "receiving-host", closed: false, booked: false });
});
describe("account requester projection fence", () => {
  it("uses the same verified association as MCP and returns only the requester target", async () => {
    expect(await authorizeRequestTool(db, call)).toBe(target);
    expect(readAccountSentAccess).toHaveBeenCalledExactlyOnceWith(db, owner, target);
  });
  it("allows a linked account's closed summary read while denying new ordinary mutations", async () => {
    vi.mocked(readAccountSentAccess).mockResolvedValue({ host_account_id: "receiving-host", closed: true, booked: false });
    expect(await authorizeRequestTool(db, call, { booked: true })).toBe(target);
    await expect(authorizeRequestTool(db, call)).rejects.toBeInstanceOf(RequestToolDeniedError);
  });
  it("refuses foreign refs, expired association access and non-linked turns", async () => {
    vi.mocked(readAccountSentAccess).mockResolvedValue(null);
    await expect(authorizeRequestTool(db, call)).rejects.toBeInstanceOf(RequestToolDeniedError);
    vi.mocked(channelOfTurn).mockResolvedValue(null);
    await expect(authorizeRequestTool(db, call)).rejects.toBeInstanceOf(RequestToolDeniedError);
  });
  it("does not give a requester or retired account session the account association path", async () => {
    await expect(authorizeRequestTool(db, { ...call, auth: { ...call.auth, attributes: { audience: "requester" } } })).rejects.toBeInstanceOf(RequestToolDeniedError);
    expect(readAccountSentAccess).not.toHaveBeenCalled();
    vi.mocked(authorizeSetupTool).mockRejectedValue(new Error("retired generation"));
    await expect(authorizeRequestTool(db, call)).rejects.toThrow("retired generation");
    expect(readAccountSentAccess).not.toHaveBeenCalled();
  });
});
