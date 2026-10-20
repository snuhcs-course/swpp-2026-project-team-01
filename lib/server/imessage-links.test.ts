import { describe, expect, it } from "vitest";
import { CODE_TTL_MS, LOCKOUT_MS, MAX_SENDS_PER_WINDOW, SEND_SPACING_MS } from "../contracts/phone-link";
import { judgeReply, LINK_TEXT, type LinkRow, linkView, maskPhone, newCode, planSend } from "./imessage-links";

// The phone check rules (host-imessage-linking design §2) as pure functions; the
// stored flow, jobs and webhook are covered in tests/integration/imessage-links.test.ts.

const now = new Date("2026-10-21T00:00:00Z");
const at = (ms: number) => new Date(now.getTime() + ms);

function link(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    code: "42",
    expires_at: at(CODE_TTL_MS),
    failure: null,
    host_account_id: "host",
    id: "link",
    phone_e164: "+821012345678",
    retry_eligible_at: at(SEND_SPACING_MS),
    revision: 0,
    status: "sent",
    valid_codes: [{ code: "42", expiresAt: at(CODE_TTL_MS).toISOString() }],
    wrong_replies: 0,
    ...overrides,
  };
}

describe("numbers", () => {
  it("are two digits from 10 to 99 and never repeat the one they replace", () => {
    const picks = [42, 42, 17];
    expect(newCode("42", () => picks.shift()!)).toBe("17");
    for (let index = 0; index < 200; index += 1) expect(newCode(null)).toMatch(/^[1-9]\d$/);
  });

  it("never appear in the text Thyme sends", () => {
    expect(LINK_TEXT).not.toMatch(/\d{2}/);
  });

  it("are shown with the phone masked to its last four digits", () => {
    expect(maskPhone("+821012345678")).toBe("•••• 5678");
  });
});

describe("planning a text", () => {
  it("sends the first text now and allows another a minute later", () => {
    expect(planSend([], now)).toEqual({ at: now, retryEligibleAt: at(SEND_SPACING_MS) });
  });

  it("holds an early request until a minute after the last text instead of refusing it", () => {
    expect(planSend([at(-20_000)], now)?.at).toEqual(at(SEND_SPACING_MS - 20_000));
  });

  it("allows no further text once the fifth in five minutes is planned", () => {
    const four = [at(-240_000), at(-180_000), at(-120_000), at(-60_000)];
    expect(planSend(four, now)).toEqual({ at: now, retryEligibleAt: null });
    expect(planSend([...four, now], now)).toBeNull();
    expect(MAX_SENDS_PER_WINDOW).toBe(5);
  });

  it("forgets texts older than five minutes", () => {
    const old = [at(-600_000), at(-540_000), at(-480_000), at(-420_000), at(-360_000)];
    expect(planSend(old, now)?.at).toEqual(now);
  });
});

describe("judging a reply", () => {
  it("connects with the shown number, ignoring surrounding spaces", () => {
    expect(judgeReply(link(), " 42\n", now)).toEqual({ kind: "connect" });
  });

  it("connects with an earlier number that has not expired", () => {
    const codes = [
      { code: "17", expiresAt: at(60_000).toISOString() },
      { code: "42", expiresAt: at(CODE_TTL_MS).toISOString() },
    ];
    expect(judgeReply(link({ valid_codes: codes }), "17", now)).toEqual({ kind: "connect" });
  });

  it("replaces the number after a wrong reply", () => {
    expect(judgeReply(link(), "41", now, () => 63)).toEqual({ code: "63", kind: "wrong", wrongReplies: 1 });
  });

  it("locks the check for five minutes on the third wrong reply", () => {
    expect(judgeReply(link({ wrong_replies: 2 }), "hello", now)).toEqual({
      kind: "lock",
      retryEligibleAt: at(LOCKOUT_MS),
      wrongReplies: 3,
    });
  });

  it("ignores a reply once every number has expired, or before any text is out", () => {
    expect(judgeReply(link(), "42", at(CODE_TTL_MS))).toEqual({ kind: "ignore" });
    expect(judgeReply(link({ code: null, status: "pending", valid_codes: [] }), "42", now)).toEqual({ kind: "ignore" });
  });

  it("ignores replies to a failed or connected check", () => {
    expect(judgeReply(link({ status: "failed" }), "42", now)).toEqual({ kind: "ignore" });
    expect(judgeReply(link({ status: "connected" }), "42", now)).toEqual({ kind: "ignore" });
  });
});

describe("the screens' view", () => {
  it("reports expired once the newest number has run out", () => {
    expect(linkView(link(), now).status).toBe("sent");
    expect(linkView(link(), at(CODE_TTL_MS)).status).toBe("expired");
    expect(linkView(link({ status: "pending" }), at(CODE_TTL_MS)).status).toBe("pending");
  });

  it("shows the masked phone, the number and times in epoch milliseconds", () => {
    expect(linkView(link(), now)).toEqual({
      code: "42",
      expiresAt: at(CODE_TTL_MS).getTime(),
      failure: null,
      phone: "•••• 5678",
      retryEligibleAt: at(SEND_SPACING_MS).getTime(),
      status: "sent",
      wrongReplies: 0,
    });
  });

  it("shows no number once connected", () => {
    expect(linkView(link({ status: "connected" }), now).code).toBeNull();
  });
});
