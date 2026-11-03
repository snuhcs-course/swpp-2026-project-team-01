import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { createImessageSendHandler, IMESSAGE_SEND_JOB, type ImessageSendDependencies, recordOutbound } from "../../lib/server/imessage-outbox";
import { photonConfig } from "../../lib/server/photon";
import { channelHash } from "../../lib/server/photon-receiver";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { newWhatsAppSender } from "./support/photon";
import { runJob, testTokenKey } from "./support/requests";

// WhatsApp sends through the outbox and the stand-in (host-whatsapp-channel task
// 2.3): a WhatsApp row goes to the WhatsApp path; a template row sends its
// template with the reference; Meta's window and template refusals are final
// with their category; a rate limit returns the row to the queue; a lost answer
// is uncertain and never sent again.

const db = testDatabase();
let photon: FakePhoton;

beforeAll(async () => {
  photon = await startFakePhoton();
});

afterAll(async () => {
  await photon.close();
  await db.end();
});

const runtime: ConversationRuntime = {
  createSession: async () => "unused",
  readEvents: () => (async function* () {})(),
  readRecordedEvents: () => (async function* () {})(),
  sendMessage: async () => undefined,
};

function deps(): ImessageSendDependencies {
  return {
    config: { ...photonConfig({}), apiUrl: photon.baseUrl, lineNumber: "+15550001111", whatsappNumber: "15550002222" },
    db,
    env: {},
    origin: "http://localhost:3000",
    runtime,
    signingKey: "x".repeat(40),
    tokenKeys: [testTokenKey],
  };
}

async function queue(options: { text: string; kind?: "command" | "template"; templateName?: string }) {
  const address = newWhatsAppSender();
  const { id } = await db.begin((tx) =>
    recordOutbound(tx, {
      channel: "whatsapp",
      dedupeKey: `test:${crypto.randomUUID()}`,
      kind: options.kind ?? "command",
      recipient: { address, spaceId: address },
      recipientHash: channelHash(testTokenKey, "whatsapp", "sender", address),
      text: options.text,
      tokenKey: testTokenKey,
      ...(options.templateName ? { templateName: options.templateName } : {}),
    }),
  );
  return { address, id };
}

async function run(outboxId: string) {
  const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${IMESSAGE_SEND_JOB} and dedupe_key = ${`outbox:${outboxId}`}`;
  await db`update app.jobs set run_after = now() where id = ${job!.id}`;
  return runJob(db, job!.id, createImessageSendHandler(deps));
}

async function rowOf(id: string) {
  const [row] = await db<{ channel: string; state: string; failure_category: string | null; provider_message_id: string | null }[]>`
    select channel, state, failure_category, provider_message_id from app.imessage_outbox where id = ${id}
  `;
  return row!;
}

describe("imessage_send on WhatsApp", () => {
  it("sends a WhatsApp row on the WhatsApp path", async () => {
    const { address, id } = await queue({ text: "Linked. Send help for what I can do here." });
    expect(await run(id)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ channel: "whatsapp", provider_message_id: expect.stringMatching(/^wamid\./), state: "accepted" });
    expect(photon.sentTo(address)).toEqual([
      expect.objectContaining({ channel: "whatsapp", content: { kind: "text", text: "Linked. Send help for what I can do here." }, idempotencyKey: id }),
    ]);
  });

  it("sends a template row as its template with the reference as the one parameter", async () => {
    const { address, id } = await queue({ kind: "template", templateName: "fmat_proposal_waiting", text: "K7Q2MX" });
    expect(await run(id)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ state: "accepted" });
    expect(photon.sentTo(address)[0]?.content).toEqual({ kind: "template", languageCode: "en_US", name: "fmat_proposal_waiting", params: ["K7Q2MX"] });
  });

  it("records Meta's window refusal and an unavailable template as final failures", async () => {
    const closed = await queue({ text: "Ready for your approval." });
    photon.closeWindow(closed.address);
    expect(await run(closed.id)).toBe("completed");
    expect(await rowOf(closed.id)).toMatchObject({ failure_category: "window_closed", state: "failed" });
    expect(await run(closed.id)).toBe("not_due");

    photon.templatesUnavailable();
    const template = await queue({ kind: "template", templateName: "fmat_request_received", text: "K7Q2MX" });
    expect(await run(template.id)).toBe("completed");
    expect(await rowOf(template.id)).toMatchObject({ failure_category: "template_unavailable", state: "failed" });
    photon.templatesUnavailable(false);
  });

  it("returns a rate-limited row to the queue and treats a lost answer as uncertain", async () => {
    const limited = await queue({ text: "Hello" });
    photon.nextSend({ status: 429 });
    expect(await run(limited.id)).toBe("failed");
    expect(await rowOf(limited.id)).toMatchObject({ failure_category: "unavailable", state: "queued" });

    const lost = await queue({ text: "Hello" });
    photon.nextSend("drop");
    expect(await run(lost.id)).toBe("completed");
    expect(await rowOf(lost.id)).toMatchObject({ state: "uncertain" });
    expect(photon.sentTo(lost.address)).toHaveLength(1);
  });
});
