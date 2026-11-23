import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderBookingEmail, type BookingEmailParameters } from "./booking-emails";
import { sealBookingLink } from "./booking-links";
import { enqueueConfirmations } from "./booking-notices";
import type { Transaction } from "./database";
import { enqueueAgreementNotice } from "./imessage-notices";
import { parseTokenKey } from "./token-encryption";

// Where a reply to the booking confirmation goes (guest-email-and-agree-notices
// design 2, #332): the guest's copy replies to the product inbox, so the answer
// reaches Thyme, and says so; without an inbox, and for the host's copy, it
// replies to the other participant as before.

const tokenKey = parseTokenKey(randomBytes(32).toString("base64"));

type Insert = { readonly table: string; readonly values: readonly unknown[] };

// Answers the statements enqueueConfirmations runs, and records every insert.
function fakeTransaction(requestId: string, options: { guestBinding?: string | null } = {}) {
  const inserts: Insert[] = [];
  const bookingId = randomUUID();
  const sealed = sealBookingLink(tokenKey, requestId, bookingId);
  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes("insert into app.email_deliveries")) {
      inserts.push({ table: "email_deliveries", values });
      return Promise.resolve([{ id: values[0] }]);
    }
    if (sql.includes("insert into app.jobs")) {
      inserts.push({ table: "jobs", values });
      return Promise.resolve([{ id: randomUUID() }]);
    }
    if (sql.includes("from app.requester_imessage_bindings")) {
      return Promise.resolve(options.guestBinding ? [{ found: true, id: options.guestBinding }] : []);
    }
    if (sql.includes("from app.booking_links")) {
      return Promise.resolve([{ link_ciphertext: sealed.ciphertext, link_key_id: sealed.keyId, request_id: requestId }]);
    }
    if (sql.includes("from app.requests r left join app.host_settings")) {
      return Promise.resolve([
        {
          contact_email: "grace@example.test",
          details: { language: "en", purpose: "Compilers", timezone: "Asia/Seoul" },
          host_email: "ada@example.test",
          host_name: "Ada Lovelace",
          host_timezone: "Asia/Seoul",
          requester_name: "Grace Hopper",
        },
      ]);
    }
    throw new Error(`Unexpected statement: ${sql}`);
  }) as unknown as Transaction & { json: (value: unknown) => unknown };
  (tx as { json: (value: unknown) => unknown }).json = (value) => value;
  return { bookingId, inserts, tx };
}

const meeting = {
  bookingId: randomUUID(),
  confirmedAt: "2026-11-23T00:00:00.000Z",
  end: "2026-11-30T01:30:00.000Z",
  iCalUID: null,
  joinUrl: null,
  location: null,
  mode: "online" as const,
  start: "2026-11-30T01:00:00.000Z",
};

// The recipient (values[5], an array), parameters (values[8]) and Reply-To
// (values[11]) of each recorded email, in enqueueEmail's column order.
function emails(inserts: readonly Insert[]) {
  return inserts
    .filter((insert) => insert.table === "email_deliveries")
    .map((insert) => ({ parameters: insert.values[8] as BookingEmailParameters, recipient: (insert.values[5] as string[])[0], replyTo: insert.values[11] }));
}

describe("the booking confirmation's Reply-To", () => {
  it("sends the guest's replies to the product inbox and the host's to the guest", async () => {
    const requestId = randomUUID();
    const { inserts, tx } = fakeTransaction(requestId);
    await enqueueConfirmations(tx, { inboxId: "Thyme@AgentMail.test", origin: "https://findmeatime.com", tokenKey, tokenKeys: [tokenKey] }, requestId, meeting);

    const [guest, host] = emails(inserts);
    expect(guest).toMatchObject({ recipient: "grace@example.test", replyTo: "thyme@agentmail.test" });
    expect(guest!.parameters.replyToAssistant).toBe(true);
    expect(host).toMatchObject({ recipient: "ada@example.test", replyTo: "grace@example.test" });
    expect(host!.parameters.replyToAssistant).toBeUndefined();
  });

  it("keeps the host's address without a product inbox", async () => {
    const requestId = randomUUID();
    const { inserts, tx } = fakeTransaction(requestId);
    await enqueueConfirmations(tx, { inboxId: null, origin: "https://findmeatime.com", tokenKey, tokenKeys: [tokenKey] }, requestId, meeting);

    const [guest] = emails(inserts);
    expect(guest).toMatchObject({ replyTo: "ada@example.test" });
    expect(guest!.parameters.replyToAssistant).toBeUndefined();
  });
});

describe("the confirmation's reply line", () => {
  const parameters: BookingEmailParameters = {
    audience: "requester",
    durationMinutes: 30,
    end: meeting.end,
    hostEmail: "ada@example.test",
    hostName: "Ada Lovelace",
    joinUrl: null,
    location: null,
    mode: "online",
    requesterEmail: "grace@example.test",
    requesterName: "Grace Hopper",
    start: meeting.start,
    timezone: "Asia/Seoul",
    title: "Compilers",
  };
  const secrets = { bookingUrl: "https://findmeatime.com/booking/0f8fad5b-d9cb-469f-a165-70867728950e" };

  it("tells the guest a reply reaches Thyme", () => {
    const email = renderBookingEmail("booking_confirmation", "en", { ...parameters, replyToAssistant: true }, secrets);
    for (const body of [email.text, email.html]) {
      expect(body).toContain("Reply to this email to reach Thyme, your scheduling assistant, about this meeting.");
      expect(body).not.toContain("reaches the other participant");
    }
  });

  it("keeps the other-participant line otherwise", () => {
    expect(renderBookingEmail("booking_confirmation", "en", parameters, secrets).text).toContain("Replying to this email reaches the other participant.");
  });
});

describe("queuing the agreement notice (#179)", () => {
  it("records one job for the active guest binding, keyed by version and binding", async () => {
    const requestId = randomUUID();
    const { inserts, tx } = fakeTransaction(requestId, { guestBinding: "binding-1" });
    await enqueueAgreementNotice(tx, requestId, 4);

    const [job] = inserts.filter((insert) => insert.table === "jobs");
    expect(job!.values[0]).toBe("imessage_notice");
    expect(job!.values[1]).toEqual({ audience: "requester", notice: { bindingId: "binding-1", kind: "agreement_sent", version: 4 }, requestId });
    expect(job!.values[2]).toBe(`guest-notice:agreement_sent:${requestId}:v4:binding-1`);
  });

  it("records nothing without a guest binding", async () => {
    const requestId = randomUUID();
    const { inserts, tx } = fakeTransaction(requestId);
    await enqueueAgreementNotice(tx, requestId, 1);
    expect(inserts).toHaveLength(0);
  });
});
