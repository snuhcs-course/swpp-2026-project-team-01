import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCalendarAnalysisHandler } from "../../lib/server/analysis";
import { runCommand } from "../../lib/server/commands";
import { addDays } from "../../lib/server/feasibility";
import { standInNoteClassifier } from "../../lib/server/note-classifier-stand-in";
import { confirmNoteReviewCommand, readNoteReview } from "../../lib/server/note-review";
import { ONBOARDING_SLOT_IMAGE_JOB, slotImageWaits } from "../../lib/server/onboarding-note-step";
import { settingsRef } from "../../lib/server/request-ref";
import { computeSetupProposal } from "../../lib/server/setup";
import { confirmSettingsForTool, createOnboardingSlotImageHandler, previewNextWeekForTool } from "../../lib/server/setup-channel-tools";
import { draftSettingsForTool, readSetupStateForTool, type SetupToolCall } from "../../lib/server/setup-tools";
import { nextWeekRange } from "../../lib/server/slot-preview";
import { testDatabase } from "./support/database";
import { startFakeGoogle, type FakeEvent, type FakeGoogle } from "./support/fake-google";
import { startFakePhoton, type FakePhoton } from "./support/fake-photon";
import { imessageHarness } from "./support/imessage";
import { runJob, testTokenKey } from "./support/requests";
import { hostCommandDeps, seedHost, setupDependencies, type SeededHost } from "./support/setup-host";

// What the host assistant can see after the note step ends (calendar-note-review
// design 8, issue #216). The review's 확인 publishes a job that records the slot
// image in the outbox, and that message never enters the agent session; the last
// tool result the agent saw is preview_next_week's noteReviewSent note ("the
// image follows by itself"). read_setup_state therefore reports the step
// (chatOnboarding), and preview_next_week sends no copy of an image already sent
// for the current review. Run on iMessage and WhatsApp; Telegram changes only how
// the image is rendered. Fixtures and helpers follow onboarding-note-step.test.ts.

const db = testDatabase();
let google: FakeGoogle;
let photon: FakePhoton;
let deps: ReturnType<typeof setupDependencies>;
const im = imessageHarness(db, () => photon, { receipt: () => ({ setup: deps }) });
const TIMEZONE = "Asia/Seoul";

beforeAll(async () => {
  google = await startFakeGoogle();
  photon = await startFakePhoton();
  const setup = setupDependencies(db, google);
  deps = { ...setup, calendar: { ...setup.calendar, tokenKeys: [setup.tokenKey, testTokenKey] } };
});
afterAll(async () => { await google.close(); await photon.close(); await db.end(); });

type Channel = "imessage" | "whatsapp";

const week = nextWeekRange(TIMEZONE, new Date());
const BIRTHDAY_DAY = addDays(week.weekStart, 2);

const events: FakeEvent[] = [
  { id: "mom-birthday", status: "confirmed", summary: "엄마 생일", start: { date: BIRTHDAY_DAY }, end: { date: addDays(BIRTHDAY_DAY, 1) }, updated: "2026-10-01T00:00:00.000Z" },
  {
    id: "client-call", status: "confirmed", summary: "Client call",
    start: { dateTime: `${week.weekStart}T10:00:00+09:00` }, end: { dateTime: `${week.weekStart}T11:00:00+09:00` },
    attendees: [{ email: "guest@example.test", responseStatus: "accepted" }], updated: "2026-10-01T00:00:00.000Z",
  },
];

async function turn(host: SeededHost, sender: string, text: string, channel: Channel): Promise<SetupToolCall> {
  expect((await im.deliver({ channel, sender, text })).outcome).toBe("forwarded");
  const [input] = await db<{ id: string }[]>`select id from app.conversation_inputs where discussion_id = ${host.discussionId} order by accepted_at desc, id desc limit 1`;
  await db`update app.agent_sessions set current_input_id = ${input!.id} where session_id = ${host.sessionId}`;
  return { auth: { principalId: host.hostAccountId, principalType: "user", attributes: { audience: "host_setup" } }, sessionId: host.sessionId, callId: randomUUID() };
}

async function analysisJob(hostAccountId: string) {
  const [job] = await db<{ id: string }[]>`
    select j.id from app.jobs j join app.calendar_analyses a on a.id::text = j.payload ->> 'analysisId'
    where a.host_account_id = ${hostAccountId} order by a.created_at desc limit 1
  `;
  return job!.id;
}

// A linked host whose scan found the birthday and who answered hours and place.
async function placeAnswered(channel: Channel) {
  const host = await seedHost(db, deps, google, { displayName: "Host" });
  google.setFixture(host.refreshToken, { calendars: host.calendars, events: { [host.primaryId]: events } });
  const { sender } = await im.link(host.hostAccountId, undefined, channel);
  await runJob(db, await analysisJob(host.hostAccountId), createCalendarAnalysisHandler(() => ({ classify: standInNoteClassifier, config: deps.calendar.config, tokenKeys: deps.calendar.tokenKeys })));
  const call = await turn(host, sender, "Weekdays 9 to 6 are fine, and online only please", channel);
  const state = await readSetupStateForTool(deps, call);
  expect(await draftSettingsForTool(deps, { ...call, callId: randomUUID() }, {
    expectedRevision: state.draftRevision,
    values: {
      meetingMode: { source: "stated", value: "online" },
      weeklyWindows: { source: "stated", value: (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map(weekday => ({ weekday, start: "09:00", end: "18:00" })) },
    },
  })).toMatchObject({ changed: true });
  return { call, host, sender };
}

async function images(hostAccountId: string) {
  return db<{ id: string; review_hash: string; state: string }[]>`select id, review_hash, state from app.imessage_outbox where host_account_id = ${hostAccountId} and kind = 'image' order by created_at, id`;
}

// Sent through the fake channel, so the row is delivered ("accepted") as on the phone.
async function deliver(outboxId: string) {
  const { sent } = await im.send(outboxId, { ...im.sendDeps(), tokenKeys: deps.calendar.tokenKeys });
  expect(sent[0]?.content).toMatchObject({ kind: "image" });
}

// The host is at the point the Telegram report describes: the review link went
// out, the host pressed 확인, and the job recorded the slot image (delivered
// unless asked not to).
async function imageSentAfterReview(channel: Channel, options: { deliver?: boolean } = {}) {
  const { call, host, sender } = await placeAnswered(channel);
  const beforeLink = await readSetupStateForTool(deps, { ...call, callId: randomUUID() });
  expect(await previewNextWeekForTool(deps, { ...call, callId: randomUUID() })).toMatchObject({ queued: false, noteReviewSent: true });
  const whileWaiting = await readSetupStateForTool(deps, { ...call, callId: randomUUID() });

  const review = await readNoteReview(db, host.hostAccountId);
  const birthday = review.items.find(item => item.title === "엄마 생일")!;
  const confirmed = await runCommand(hostCommandDeps(db, host.hostAccountId), confirmNoteReviewCommand, {
    input: { analysisId: review.analysisId!, choices: [{ key: birthday.key, decision: "free" }] }, resourceId: host.hostAccountId, retryKey: randomUUID(),
  });
  expect(confirmed).toMatchObject({ ok: true, result: { slotImage: true } });
  const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${ONBOARDING_SLOT_IMAGE_JOB} and payload ->> 'hostAccountId' = ${host.hostAccountId} and payload ->> 'waited' is null`;
  expect(await runJob(db, job!.id, createOnboardingSlotImageHandler(() => deps))).toBe("completed");
  const [image] = await images(host.hostAccountId);
  expect(image).toBeDefined();
  if (options.deliver !== false) await deliver(image!.id);
  expect(await slotImageWaits(db, host.hostAccountId)).toBe(false);
  const proposal = (await computeSetupProposal(db, host.hostAccountId))!;
  expect(image!.review_hash).toBe(proposal.proposalHash);
  return { call, host, sender, image: image!, proposal, beforeLink, whileWaiting };
}

describe.each<Channel>(["imessage", "whatsapp"])("on %s, after 확인 sent the slot image (issue #216)", (channel) => {
  it("read_setup_state tells the agent the note step is over and the image for the current reviewRef went out", async () => {
    const { call, host, beforeLink, whileWaiting, proposal } = await imageSentAfterReview(channel, { deliver: false });
    const ref = settingsRef(proposal.proposalHash);
    expect(beforeLink.chatOnboarding).toEqual({ noteReview: null, slotPreview: null });
    expect(whileWaiting.chatOnboarding).toEqual({ noteReview: "waiting", slotPreview: null });

    // Recorded by the job, not yet delivered.
    const sending = await readSetupStateForTool(deps, { ...call, callId: randomUUID() });
    expect(sending.chatOnboarding).toEqual({ noteReview: "done", slotPreview: { current: true, delivery: "sending", reviewRef: ref } });

    const [image] = await images(host.hostAccountId);
    await deliver(image!.id);
    const delivered = await readSetupStateForTool(deps, { ...call, callId: randomUUID() });
    expect(delivered.chatOnboarding).toEqual({ noteReview: "done", slotPreview: { current: true, delivery: "delivered", reviewRef: ref } });
    expect(delivered.reviewRef).toBe(ref);
    // Model-facing only: no titles or calendar text.
    expect(JSON.stringify(delivered.chatOnboarding)).not.toContain("생일");
  });

  it("preview_next_week called again reports the image already sent and sends no copy", async () => {
    const { call, host, image, proposal } = await imageSentAfterReview(channel);
    const again = await previewNextWeekForTool(deps, { ...call, callId: randomUUID() });
    expect(again).toMatchObject({ queued: false, alreadySent: true, delivery: "delivered", reviewRef: settingsRef(proposal.proposalHash), ranges: expect.stringContaining(BIRTHDAY_DAY) });
    expect(again).not.toHaveProperty("waitingForNoteReview");
    expect((await images(host.hostAccountId)).map(row => row.id)).toEqual([image.id]);
  });

  it("sends a new image after a changed setting, and again when the last one was not delivered", async () => {
    const { host, sender, image } = await imageSentAfterReview(channel);
    const change = await turn(host, sender, "Make it 10 to 5 instead", channel);
    const state = await readSetupStateForTool(deps, change);
    expect(await draftSettingsForTool(deps, { ...change, callId: randomUUID() }, {
      expectedRevision: state.draftRevision,
      values: { weeklyWindows: { source: "stated", value: (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map(weekday => ({ weekday, start: "10:00", end: "17:00" })) } },
    })).toMatchObject({ changed: true });
    const changed = (await computeSetupProposal(db, host.hostAccountId))!;
    expect(changed.proposalHash).not.toBe(image.review_hash);
    expect((await readSetupStateForTool(deps, { ...change, callId: randomUUID() })).chatOnboarding)
      .toEqual({ noteReview: "done", slotPreview: { current: false, delivery: "delivered", reviewRef: settingsRef(image.review_hash) } });

    expect(await previewNextWeekForTool(deps, { ...change, callId: randomUUID() })).toMatchObject({ queued: true, reviewRef: settingsRef(changed.proposalHash) });
    const [, second] = await images(host.hostAccountId);
    expect(second!.review_hash).toBe(changed.proposalHash);

    // Held back (as on a closed WhatsApp window): the host may not have it.
    await db`update app.imessage_outbox set state = 'failed', failure_category = 'window_closed', completed_at = now(), recipient_ciphertext = null, text_ciphertext = null where id = ${second!.id}`;
    expect((await readSetupStateForTool(deps, { ...change, callId: randomUUID() })).chatOnboarding?.slotPreview).toMatchObject({ current: true, delivery: "not_delivered" });
    expect(await previewNextWeekForTool(deps, { ...change, callId: randomUUID() })).toMatchObject({ queued: true });
    expect(await images(host.hostAccountId)).toHaveLength(3);
  });

  it("confirm in words accepts the job-sent image, with no second preview", async () => {
    const { host, sender, proposal } = await imageSentAfterReview(channel);
    const yes = await turn(host, sender, "Yes, open those", channel);
    expect(await confirmSettingsForTool(deps, yes, { reviewRef: settingsRef(proposal.proposalHash) })).toMatchObject({ saved: true });
    expect(await images(host.hostAccountId)).toHaveLength(1);
  });
});
