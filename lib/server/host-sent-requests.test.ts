import { describe, expect, it } from "vitest";
import { hostRequestsForModel, SENT_NOTE } from "./host-review-tools";
import { namedSentRequest } from "./imessage-receipts";
import { handleFromText, START_REQUEST_DESCRIPTION, startRequestForTool, startRequestToolInput } from "./host-sent-requests";

// host-as-guest-messenger (R01 M-1, M-1.1, M-8; #334).
describe("handleFromText", () => {
  const origin = "https://findmeatime.com";

  it("reads a booking link on the product domain or the app origin", () => {
    expect(handleFromText("findmeatime.com/dodo", origin)).toBe("dodo");
    expect(handleFromText("https://findmeatime.com/dodo?x=1", origin)).toBe("dodo");
    expect(handleFromText("Can you book me with https://www.findmeatime.com/@Dodo.", origin)).toBe("dodo");
    expect(handleFromText("http://localhost:3000/dodo", "http://localhost:3000")).toBe("dodo");
  });

  it("reads an @handle, also the full-width one, and a bare handle", () => {
    expect(handleFromText("Book a meeting with @dodo next week", origin)).toBe("dodo");
    expect(handleFromText("＠dodo랑 미팅 잡아줘", origin)).toBe("dodo");
    expect(handleFromText("dodo", origin)).toBe("dodo");
  });

  it("names nothing for other sites, addresses or plain sentences", () => {
    expect(handleFromText("https://example.com/dodo", origin)).toBeNull();
    expect(handleFromText("mail me at ada@example.com", origin)).toBeNull();
    expect(handleFromText("Book a meeting next week", origin)).toBeNull();
  });
});

describe("start_request", () => {
  it("takes the link or handle and asks for another meeting only explicitly", () => {
    expect(startRequestToolInput.parse({ to: "@dodo" })).toEqual({ another: false, to: "@dodo" });
    expect(startRequestToolInput.safeParse({ to: "@dodo", name: "Ada" }).success).toBe(false);
    expect(START_REQUEST_DESCRIPTION).toContain("ask nothing about them");
    expect(START_REQUEST_DESCRIPTION).toContain("own");
  });

  it("refuses a session that is not a host's own", async () => {
    const call = { auth: { attributes: { audience: "requester" }, principalId: "request:x", principalType: "user" }, callId: "c", sessionId: "s" };
    const deps = { appOrigin: "https://findmeatime.com", db: null as never, tokenKey: null as never, tokenKeys: [] };
    await expect(startRequestForTool(deps, call, { another: false, to: "@dodo" })).resolves.toMatchObject({ started: false });
  });

  // Testing baseline R01 M-1.1: the host's own link or handle starts nothing.
  it("answers own for the host's own link and writes nothing", async () => {
    const me = "00000000-0000-4000-8000-000000000001";
    const queries: string[] = [];
    const db = ((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      queries.push(text);
      if (text.includes("from app.agent_sessions")) return Promise.resolve([{ channel: "imessage", inputId: "input-1", message: "[iMessage] findmeatime.com/barbara" }]);
      if (text.includes("from app.host_handles where handle")) return Promise.resolve([{ host_account_id: me }]);
      return Promise.reject(new Error(`unexpected query: ${text}`));
    }) as never;
    const call = { auth: { attributes: { audience: "host_setup" }, principalId: me, principalType: "user" }, callId: "c", sessionId: "s" };
    const deps = { appOrigin: "https://findmeatime.com", db, tokenKey: null as never, tokenKeys: [] };

    for (const to of ["findmeatime.com/barbara", "@barbara"]) {
      await expect(startRequestForTool(deps, call, { another: false, to })).resolves.toMatchObject({ own: true, started: false });
    }
    expect(queries.every((text) => text.trimStart().startsWith("select"))).toBe(true);
  });
});

describe("list_host_requests with sent requests", () => {
  it("lists sent requests apart from received ones, by host", () => {
    const now = new Date("2026-11-23T00:00:00Z");
    const result = hostRequestsForModel([], "Asia/Seoul", now, [
      { bookedStart: null, hostName: "박도현", proposalStart: "2026-11-26T06:00:00Z", purpose: "Investment advice", requestId: "00000000-0000-4000-8000-000000000001", state: "awaiting_host_approval", updatedAt: now.toISOString() },
    ]);
    expect(result.requests).toEqual([]);
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0]).toMatchObject({ booked: null, state: "awaiting_host_approval", proposed: { week: expect.any(String) } });
    expect(JSON.stringify(result.sent[0])).toContain("박도현");
    expect(result.sentNote).toBe(SENT_NOTE);
    expect(hostRequestsForModel([], "Asia/Seoul").sent).toEqual([]);
  });
});

describe("namedSentRequest", () => {
  const will = { host_name: "Will Smith", request_id: "00000000-0000-4000-8000-000000000002" };
  const dodo = { host_name: "박도현", request_id: "00000000-0000-4000-8000-000000000003" };

  it("names a sent request by its host's full name only, never by one word", () => {
    expect(namedSentRequest("I will approve it", [will, dodo], true)).toBeNull();
    expect(namedSentRequest("About my meeting with Will Smith", [will, dodo], true)).toBe(will);
    expect(namedSentRequest("박도현님 요청 어떻게 됐어?", [will, dodo], true)).toBe(dodo);
  });

  it("names nothing by name while a received request is selected", () => {
    expect(namedSentRequest("About my meeting with Will Smith", [will, dodo], false)).toBeNull();
  });

  it("goes to the host role when the sender says they are the host", () => {
    expect(namedSentRequest("I'm the host, show my settings", [will], false)).toBe("host");
  });
});
