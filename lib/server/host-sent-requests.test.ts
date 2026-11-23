import { describe, expect, it } from "vitest";
import { hostRequestsForModel, SENT_NOTE } from "./host-review-tools";
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
