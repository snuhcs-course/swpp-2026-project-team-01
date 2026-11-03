import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestRef } from "../../lib/server/imessage-commands";
import { createImessageNoticeHandler } from "../../lib/server/imessage-notice-job";
import { enqueueHostNotice, IMESSAGE_NOTICE_JOB } from "../../lib/server/imessage-notices";
import { agreedRequest } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness } from "./support/imessage";
import { runJob, testTokenKey } from "./support/requests";

// WhatsApp's 24-hour window and its templates (host-whatsapp-channel task 4.1):
// a summary inside the window goes out as text; outside it the text is never
// sent and one template with only the request reference goes instead; further
// summaries within 12 hours send no second template; the line's daily limit
// holds; Meta's own 131047 refusal ends the text and queues the template; a
// reply outside the window sends nothing and no template.

const db = testDatabase();
let photon: FakePhoton;
let google: FakeGoogle;
const im = imessageHarness(db, () => photon);

beforeAll(async () => {
  photon = await startFakePhoton();
  google = await startFakeGoogle();
});

afterAll(async () => {
  await photon.close();
  await google.close();
  await db.end();
});

const noticeDeps = () => ({ db, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] });

async function runNotices(requestId: string) {
  const jobs = await db<{ id: string }[]>`
    select id from app.jobs where kind = ${IMESSAGE_NOTICE_JOB} and state = 'pending' and payload ->> 'requestId' = ${requestId} order by created_at
  `;
  for (const job of jobs) await runJob(db, job.id, createImessageNoticeHandler(noticeDeps));
}

async function rows(hostAccountId: string) {
  return db<{ id: string; kind: string; state: string; failure_category: string | null; template_name: string | null }[]>`
    select id, kind, state, failure_category, template_name from app.imessage_outbox
    where host_account_id = ${hostAccountId} and kind in ('notice', 'template') order by created_at
  `;
}

async function quietFor(hostAccountId: string, hours: number) {
  await db`
    update app.imessage_bindings set last_inbound_at = now() - make_interval(hours => ${hours})
    where host_account_id = ${hostAccountId} and state = 'active'
  `;
}

async function whatsAppAgreed() {
  let sender = "";
  const request = await agreedRequest(db, google, {
    beforeAgree: async (seeded) => {
      sender = (await im.link(seeded.hostAccountId, undefined, "whatsapp")).sender;
    },
  });
  return { request, sender };
}

describe("the WhatsApp window", () => {
  it("sends a summary as text while the host wrote within the window", async () => {
    const { request, sender } = await whatsAppAgreed();
    await runNotices(request.requestId);
    const [notice] = await rows(request.hostAccountId);
    const { sent } = await im.send(notice!.id);
    expect(sent).toEqual([expect.objectContaining({ channel: "whatsapp", recipient: { address: sender, spaceId: sender } })]);
    expect(sent[0]!.content).toMatchObject({ kind: "text", text: expect.stringMatching(/^Ready for your approval\./) });
  });

  it("sends one template with only the reference when the window has closed", async () => {
    const { request, sender } = await whatsAppAgreed();
    await quietFor(request.hostAccountId, 30);
    await runNotices(request.requestId);
    const [notice] = await rows(request.hostAccountId);
    expect((await im.send(notice!.id)).sent).toEqual([]);

    const [closed, template] = await rows(request.hostAccountId);
    expect(closed).toMatchObject({ failure_category: "window_closed", kind: "notice", state: "suppressed" });
    expect(template).toMatchObject({ kind: "template", state: "queued", template_name: "fmat_proposal_waiting" });
    const { sent } = await im.send(template!.id);
    expect(sent).toEqual([
      expect.objectContaining({
        channel: "whatsapp",
        content: { kind: "template", languageCode: "en_US", name: "fmat_proposal_waiting", params: [requestRef(request.requestId)] },
        recipient: { address: sender, spaceId: sender },
      }),
    ]);
  });

  it("sends no second template within 12 hours, and none past the line's daily limit", async () => {
    const { request } = await whatsAppAgreed();
    await quietFor(request.hostAccountId, 30);
    await runNotices(request.requestId);
    await im.send((await rows(request.hostAccountId))[0]!.id);

    await db.begin((tx) => enqueueHostNotice(tx, request.requestId, { kind: "new_request" }));
    await runNotices(request.requestId);
    const later = (await rows(request.hostAccountId)).find((row) => row.kind === "notice" && row.state === "queued");
    await im.send(later!.id);
    const all = await rows(request.hostAccountId);
    expect(all.filter((row) => row.kind === "template")).toHaveLength(1);
    expect(all.filter((row) => row.failure_category === "window_closed")).toHaveLength(2);

    const other = await whatsAppAgreed();
    await quietFor(other.request.hostAccountId, 30);
    await runNotices(other.request.requestId);
    const [notice] = await rows(other.request.hostAccountId);
    await im.send(notice!.id, { ...im.sendDeps(), templateDailyLimit: 0 });
    expect((await rows(other.request.hostAccountId)).filter((row) => row.kind === "template")).toEqual([]);
    // /app shows why: the host had not written for a day.
    expect(await im.status(other.request.hostAccountId)).toMatchObject({
      channel: "whatsapp",
      delivery: { reason: "window_closed", state: "failed" },
      state: "linked",
    });
  });

  it("ends text Meta refuses as outside the window, and queues the template", async () => {
    const { request, sender } = await whatsAppAgreed();
    photon.closeWindow(sender);
    await runNotices(request.requestId);
    const [notice] = await rows(request.hostAccountId);
    await im.send(notice!.id);
    const [refused, template] = await rows(request.hostAccountId);
    expect(refused).toMatchObject({ failure_category: "window_closed", state: "failed" });
    expect(template).toMatchObject({ kind: "template", template_name: "fmat_proposal_waiting" });
  });

  it("sends a reply outside the window nowhere, and no template for it", async () => {
    const { request } = await whatsAppAgreed();
    const [linked] = await db<{ id: string }[]>`
      select id from app.imessage_outbox where host_account_id = ${request.hostAccountId} and kind = 'linked'
    `;
    await quietFor(request.hostAccountId, 25);
    expect((await im.send(linked!.id)).sent).toEqual([]);
    const [row] = await db<{ state: string; failure_category: string }[]>`select state, failure_category from app.imessage_outbox where id = ${linked!.id}`;
    expect(row).toEqual({ failure_category: "window_closed", state: "suppressed" });
    expect((await rows(request.hostAccountId)).filter((r) => r.kind === "template")).toEqual([]);
  });
});
