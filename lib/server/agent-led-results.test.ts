import { afterAll, describe, expect, it, vi } from "vitest";
import { HOST_TOOLS } from "./agent-host-tools";
import { REQUESTER_TOOLS } from "./agent-requester-tools";
import { runAsGrant, type AgentToolContext } from "./agent-tools";
import { createDatabase } from "./database";
import { parseTokenKey } from "./token-encryption";

vi.mock("./agent-tools", async importOriginal => ({ ...await importOriginal<typeof import("./agent-tools")>(), runAsGrant: vi.fn() }));
vi.mock("./google-calendar", async importOriginal => ({ ...await importOriginal<typeof import("./google-calendar")>(), openHostCalendar: async () => ({ listCalendars: async () => ({ calendars: [] }) }) }));
vi.mock("./requester-routes", () => ({ readRequesterView: async () => null }));
const db = createDatabase("postgresql://postgres:postgres@127.0.0.1:9/postgres");
const key = parseTokenKey(Buffer.alloc(32).toString("base64"));
const context: AgentToolContext = {
  access: { bootstrap: false, clientId: "client", closed: false, creationRetryKey: null, grantId: "grant", hostAccountId: "host", requestId: "request", resource: "https://findmeatime.test/mcp", role: "host", scopes: ["host:write"], sourceHash: "source" },
  deps: { db, origin: "https://findmeatime.test", tokenKey: () => key, setup: { db, appOrigin: "https://findmeatime.test", calendar: { db, config: { apiBaseUrl: "http://127.0.0.1:9", tokenUrl: "http://127.0.0.1:9", clientId: "test", clientSecret: "test", timeoutMs: 1 }, tokenKeys: [key] } } },
};
afterAll(() => db.end());
describe("service-written result guidance", () => {
  it("adds the setup next sentence and does not send hostWords into a command", async () => {
    vi.mocked(runAsGrant).mockResolvedValueOnce({ ok: true, correlationId: "id", replayed: false, result: { handle: "dodo", links: {} } });
    const result = await HOST_TOOLS.find(tool => tool.name === "confirm_setup")!.run(context, { expectedRevision: 1, proposalHash: "a".repeat(64), retryKey: "confirm-0001", hostWords: "Yes, confirm." });
    expect(result).toMatchObject({ ok: true, result: { next: "Setup is confirmed. Give the host the booking link to share. You are not notified of new requests: tell the host to ask you to check for requests, and use list_requests when they do." } });
    expect(vi.mocked(runAsGrant).mock.lastCall?.[2].input).toEqual({ proposalHash: "a".repeat(64) });
  });
  it("adds the agreement sentence only when agreement was recorded", async () => {
    const tool = REQUESTER_TOOLS.find(tool => tool.name === "agree_to_proposal")!;
    for (const outcome of ["agreed", "time_unavailable"]) {
      vi.mocked(runAsGrant).mockResolvedValueOnce({ ok: true, correlationId: "id", replayed: false, result: { outcome } });
      const result = await tool.run(context, { retryKey: "agree-0001", input: { version: 1 } });
      if (outcome === "agreed") expect(result).toMatchObject({ ok: true, result: { next: "The person agreed to this time. Tell them the host must still approve, nothing is booked yet, and the outcome arrives by email. They can ask you to check again with get_request." } });
      else expect(result).not.toHaveProperty("result.next");
    }
  });
});
