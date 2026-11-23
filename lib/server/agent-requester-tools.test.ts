import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_REQUESTER_TOOLS, sentText } from "./agent-account-requester-tools";
import { AGREED_NEXT, CHANGE_AGREEMENT_NEXT, REQUESTER_TOOLS } from "./agent-requester-tools";
import { runAsGrant, type AgentToolContext } from "./agent-tools";
import { createDatabase } from "./database";
import { readRequesterView } from "./requester-routes";
import { changeAgreementCommand } from "./request-proposals";
import { parseTokenKey } from "./token-encryption";

vi.mock("./agent-tools", async (importOriginal) => ({ ...(await importOriginal<typeof import("./agent-tools")>()), runAsGrant: vi.fn() }));
vi.mock("./requester-routes", () => ({ readRequesterView: vi.fn(async () => null) }));

const db = createDatabase("postgresql://postgres:postgres@127.0.0.1:9/postgres");
const key = parseTokenKey(Buffer.alloc(32).toString("base64"));
const context: AgentToolContext = {
  access: { bootstrap: false, clientId: "client", closed: false, creationRetryKey: "create-0001", grantId: "grant", hostAccountId: "host", requestId: "request", resource: "https://findmeatime.test/h/mcp", role: "requester", scopes: ["request:read", "request:write", "request:decide"], sourceHash: "source" },
  deps: { db, origin: "https://findmeatime.test", tokenKey: () => key, setup: { db, appOrigin: "https://findmeatime.test", calendar: { db, config: { apiBaseUrl: "http://127.0.0.1:9", tokenUrl: "http://127.0.0.1:9", clientId: "test", clientSecret: "test", timeoutMs: 1 }, tokenKeys: [key] } } },
};
const tool = (name: string) => REQUESTER_TOOLS.find((candidate) => candidate.name === name)!;
const succeed = (result: unknown) => vi.mocked(runAsGrant).mockResolvedValueOnce({ ok: true, correlationId: "id", replayed: false, result });
const refuse = (category: "invalid_input" | "stale_revision") => vi.mocked(runAsGrant).mockResolvedValueOnce({ ok: false, error: { category, correlationId: "id", message: "refused" } } as never);
const waitingView = { request: { state: "awaiting_host_approval" } } as unknown as Awaited<ReturnType<typeof readRequesterView>>;

afterAll(() => db.end());
beforeEach(() => {
  vi.mocked(runAsGrant).mockReset();
  vi.mocked(readRequesterView).mockReset().mockResolvedValue(null);
});

// #331: the MCP guest agent reopens an agreed request the way the web's Change does.
describe("change_agreement", () => {
  it("runs the booking page's Change command as the requester, with request:decide", async () => {
    succeed({ revision: 5, state: "negotiating" });
    const result = await tool("change_agreement").run(context, { retryKey: "change-0001", expectedRevision: 4 });
    expect(vi.mocked(runAsGrant).mock.lastCall?.[1]).toBe(changeAgreementCommand);
    expect(vi.mocked(runAsGrant).mock.lastCall?.[2]).toEqual({ expectedRevision: 4, input: {}, resourceId: "request", retryKey: "change-0001" });
    expect(result).toMatchObject({ ok: true, result: { next: CHANGE_AGREEMENT_NEXT, outcome: { state: "negotiating" } } });
    expect(tool("change_agreement").scope).toBe("request:decide");
  });

  it("says there is nothing to reopen when the request no longer waits for the host", async () => {
    refuse("stale_revision");
    const result = await tool("change_agreement").run(context, { retryKey: "change-0002" });
    expect(result).toMatchObject({ ok: false, category: "stale_revision", nextAction: expect.stringContaining("nothing to reopen") });
  });

  it("is offered on the account connection by requestId too, naming the sent booking tools", () => {
    const sent = ACCOUNT_REQUESTER_TOOLS.find((candidate) => candidate.name === "change_agreement")!;
    expect(sent.description).toContain("change_sent_booking");
    expect(sent.description).not.toMatch(/\bchange_booking\b/);
  });

  it("names the sent booking tools in the account connection's refusals", async () => {
    refuse("stale_revision");
    const refusal = await tool("change_agreement").run(context, { retryKey: "change-0003" });
    expect(!refusal.ok && sentText(refusal.nextAction)).toContain("changed with change_sent_booking");
    expect(sentText("get_request, check_booking and cancel_booking")).toBe("get_sent_request, check_sent_booking and cancel_sent_booking");
  });
});

// While the request awaits approval the details card's command refuses; the
// agent is pointed at change_agreement rather than told to retry.
describe("changes while the agreement waits for the host", () => {
  for (const name of ["update_request_details", "find_times", "choose_time"]) {
    it(`${name} points at change_agreement`, async () => {
      refuse("invalid_input");
      vi.mocked(readRequesterView).mockResolvedValueOnce(waitingView);
      const result = await tool(name).run(context, { retryKey: "retry-0001" });
      expect(result).toMatchObject({ ok: false, category: "invalid_input", nextAction: expect.stringContaining("call change_agreement first") });
    });
  }

  it("keeps the command's refusal when the request cannot be read", async () => {
    refuse("invalid_input");
    vi.mocked(readRequesterView).mockRejectedValueOnce(new Error("down"));
    const result = await tool("find_times").run(context, { retryKey: "retry-0003" });
    expect(result).toMatchObject({ ok: false, category: "invalid_input", nextAction: expect.not.stringContaining("change_agreement") });
  });

  it("reads the request only for an unexplained invalid_input", async () => {
    vi.mocked(runAsGrant).mockResolvedValueOnce({ ok: false, error: { category: "invalid_input", correlationId: "id", message: "refused", reason: "start_passed" } } as never);
    const passed = await tool("choose_time").run(context, { retryKey: "retry-0004", input: { evaluationId: "e", candidateId: "c" } });
    expect(passed).toMatchObject({ ok: false, nextAction: "That time has already started. Find times again." });
    refuse("stale_revision");
    await tool("update_request_details").run(context, { retryKey: "retry-0005" });
    expect(readRequesterView).not.toHaveBeenCalled();
  });

  it("keeps the generic refusal when the request is not waiting", async () => {
    refuse("invalid_input");
    const result = await tool("update_request_details").run(context, { retryKey: "retry-0002" });
    expect(result).toMatchObject({ ok: false, nextAction: expect.not.stringContaining("change_agreement") });
  });
});

// #381: the agent reports only what the outcome records, so it never says a
// time is agreed or waiting for the host when the host was not asked.
describe("choose and agree outcomes", () => {
  it("choose_time says the chosen version is not agreed yet", async () => {
    succeed({ outcome: "proposed", version: 2 });
    const result = await tool("choose_time").run(context, { retryKey: "choose-0001", input: { evaluationId: "e", candidateId: "c" } });
    expect(result).toMatchObject({ ok: true, result: { next: expect.stringContaining("nothing is agreed and the host has not been asked") } });
    expect(result).toMatchObject({ result: { next: expect.stringContaining("agree_to_proposal with version 2") } });
  });

  it("choose_time says nothing was chosen when the online time needs a link", async () => {
    succeed({ outcome: "needs_meeting_link" });
    const result = await tool("choose_time").run(context, { retryKey: "choose-0002", input: { evaluationId: "e", candidateId: "c" } });
    expect(result).toMatchObject({ ok: true, result: { next: expect.stringMatching(/^Nothing was chosen/) } });
  });

  it("agree_to_proposal says nothing was agreed when the host's time is gone", async () => {
    succeed({ evaluationId: "e2", outcome: "time_unavailable", version: 2 });
    const result = await tool("agree_to_proposal").run(context, { retryKey: "agree-0001", input: { version: 2 } });
    expect(result).toMatchObject({ ok: true, result: { next: expect.stringMatching(/^Nothing was agreed/) } });
    expect(result).not.toMatchObject({ result: { next: AGREED_NEXT } });
  });

  it("agree_to_proposal says to find times again when no new search started", async () => {
    succeed({ evaluationId: null, outcome: "time_unavailable", version: 2 });
    const result = await tool("agree_to_proposal").run(context, { retryKey: "agree-0003", input: { version: 2 } });
    expect(result).toMatchObject({ ok: true, result: { next: expect.stringContaining("call find_times again") } });
  });

  it("agree_to_proposal tells the host must approve only after an agreement", async () => {
    succeed({ outcome: "agreed", revision: 4, state: "awaiting_host_approval", version: 2 });
    const result = await tool("agree_to_proposal").run(context, { retryKey: "agree-0002", input: { version: 2 } });
    expect(result).toMatchObject({ ok: true, result: { next: AGREED_NEXT } });
  });

  it("keeps the choosing-is-not-agreeing guidance on the account connection", () => {
    const sent = ACCOUNT_REQUESTER_TOOLS.find((candidate) => candidate.name === "choose_time")!;
    expect(sent.description).toContain("choosing is not agreeing");
  });
});
