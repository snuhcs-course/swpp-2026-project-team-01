import { describe, expect, it } from "vitest";
import { classifyReplyResponse, type ReceivedMessage, senderAddress, senderAuthenticated, senderName, startsThread } from "./agentmail";
import { carriesLinkCode, messageLanguage, subjectHandles } from "./email-receipts";
import { turnReplyText, withFooter } from "./email-replies";

// What a received message proves (requester-email-channel D5), how a reply's
// answer is classified (D8), and the text a turn reply carries.

function message(overrides: Partial<ReceivedMessage> = {}): ReceivedMessage {
  return {
    authentication_results: { dmarc: "pass" },
    from: "Grace Hopper <grace@example.com>",
    inbox_id: "findmeatime@agentmail.to",
    labels: ["received"],
    message_id: "<m@example.com>",
    thread_id: "thr_1",
    ...overrides,
  };
}

describe("sender evidence", () => {
  it("reads the address and name of a From value", () => {
    expect(senderAddress("Grace Hopper <Grace@Example.com>")).toBe("grace@example.com");
    expect(senderAddress("grace@example.com")).toBe("grace@example.com");
    expect(senderAddress("Two <a@x.com>, <b@y.com>")).toBe("b@y.com");
    expect(senderAddress("not an address")).toBeNull();
    expect(senderName('"Hopper, Grace" <grace@example.com>')).toBe("Hopper, Grace");
    expect(senderName("grace@example.com")).toBeNull();
  });

  it("accepts DMARC, or DKIM aligned with the From domain", () => {
    expect(senderAuthenticated(message())).toBe(true);
    expect(senderAuthenticated(message({ authentication_results: { dkim: "pass", dkim_domain: "example.com" } }))).toBe(true);
  });

  it("refuses unaligned DKIM, SPF alone, failures and AgentMail's refusal labels", () => {
    expect(senderAuthenticated(message({ authentication_results: { dkim: "pass", dkim_domain: "mailer.example.net" } }))).toBe(false);
    expect(senderAuthenticated(message({ authentication_results: { spf: "pass" } }))).toBe(false);
    expect(senderAuthenticated(message({ authentication_results: { dmarc: "fail" } }))).toBe(false);
    expect(senderAuthenticated(message({ authentication_results: null }))).toBe(false);
    expect(senderAuthenticated(message({ labels: ["received", "unauthenticated"] }))).toBe(false);
    expect(senderAuthenticated(message({ labels: ["spam"] }))).toBe(false);
  });

  it("tells a new thread from a reply", () => {
    expect(startsThread(message())).toBe(true);
    expect(startsThread(message({ in_reply_to: "<a@b>" }))).toBe(false);
    expect(startsThread(message({ references: ["<a@b>"] }))).toBe(false);
  });
});

describe("subjects and text", () => {
  it("finds host handles in a subject", () => {
    expect(subjectHandles("Meeting with @Alice-Kim about the launch")).toEqual(["alice-kim"]);
    expect(subjectHandles("Re: (@bob) and @carol")).toEqual(["bob", "carol"]);
    expect(subjectHandles("mail me at someone@alice.com")).toEqual([]);
    expect(subjectHandles(null)).toEqual([]);
  });

  it("finds link codes and the message language", () => {
    expect(carriesLinkCode("Linking FMAT-0123456789 thanks")).toBe(true);
    expect(carriesLinkCode("fmat-abcdefghjk")).toBe(true);
    expect(carriesLinkCode("FMAT-ILOU000000")).toBe(false);
    expect(messageLanguage("다음 주에 만날 수 있을까요?")).toBe("ko");
    expect(messageLanguage("Next week?")).toBe("en");
  });
});

describe("reply answers", () => {
  it("accepts only a message ID, and never claims a refusal or a conflict as sent", () => {
    expect(classifyReplyResponse(200, { message_id: "<r@x>", thread_id: "thr" })).toEqual({ messageId: "<r@x>", status: "accepted", threadId: "thr" });
    expect(classifyReplyResponse(200, {})).toMatchObject({ reason: "missing_evidence", status: "uncertain" });
    expect(classifyReplyResponse(403, {})).toEqual({ httpStatus: 403, status: "rejected" });
    expect(classifyReplyResponse(409, {})).toMatchObject({ reason: "conflict", status: "uncertain" });
    expect(classifyReplyResponse(429, {})).toMatchObject({ reason: "busy", status: "uncertain" });
    expect(classifyReplyResponse(502, null)).toMatchObject({ reason: "server_error", status: "uncertain" });
  });
});

describe("turn reply text", () => {
  const event = (deliveryIds: string[], message: string, finishReason = "stop") =>
    ({ data: { finishReason, message }, meta: { at: "", deliveryIds }, type: "message.completed" }) as never;

  it("joins the final texts of the input's own turn", () => {
    const events = [
      event(["d0"], "An earlier turn."),
      event(["d1"], "Checking.", "tool-calls"),
      event(["d1"], "Here are three times."),
      event(["d1", "d2"], "Pick one on your booking page."),
      { data: {}, meta: { at: "", deliveryIds: ["d1"] }, type: "turn.completed" } as never,
    ];
    expect(turnReplyText(events, ["d1"])).toBe("Here are three times.\n\nPick one on your booking page.");
    expect(turnReplyText(events, ["d9"])).toBeNull();
  });

  it("adds the footer in the request's language", () => {
    expect(withFooter("Hi", "en")).toMatch(/^Hi\n\n--\nTo pick a time/);
    expect(withFooter("안녕하세요", "ko")).toContain("예약 링크");
  });
});
