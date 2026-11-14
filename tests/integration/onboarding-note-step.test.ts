import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCalendarAnalysisHandler } from "../../lib/server/analysis";
import { channelReplies } from "../../lib/server/channel-texts";
import { runCommand } from "../../lib/server/commands";
import { addDays } from "../../lib/server/feasibility";
import { limitNoteClassifier, MODEL_LIMITS, ModelLimitError } from "../../lib/server/model-limits";
import type { NoteClassifierModel } from "../../lib/server/note-classifier";
import { standInNoteClassifier } from "../../lib/server/note-classifier-stand-in";
import { confirmNoteReviewCommand, readNoteReview } from "../../lib/server/note-review";
import { ONBOARDING_SLOT_IMAGE_JOB, slotImageWaits } from "../../lib/server/onboarding-note-step";
import { settingsRef } from "../../lib/server/request-ref";
import { computeSetupProposal } from "../../lib/server/setup";
import { confirmSettingsForTool, createOnboardingSlotImageHandler, previewNextWeekForTool } from "../../lib/server/setup-channel-tools";
import { draftSettingsForTool, readSetupStateForTool, type SetupToolCall } from "../../lib/server/setup-tools";
import { nextWeekRange } from "../../lib/server/slot-preview";
import type { SlotPreview } from "../../lib/contracts/slot-preview";
import { testDatabase } from "./support/database";
import { startFakeGoogle, type FakeEvent, type FakeGoogle } from "./support/fake-google";
import { startFakePhoton, type FakePhoton } from "./support/fake-photon";
import { imessageHarness } from "./support/imessage";
import { runJob, testTokenKey } from "./support/requests";
import { unlinkImessageCommand } from "../../lib/server/imessage-links";
import { hostCommandDeps, seedHost, setupDependencies, type SeededHost } from "./support/setup-host";

// The note step of the chat onboarding (calendar-note-review task 4.1, design 8):
// after the place answer the review link goes out instead of the slot image, the
// image follows the review's 확인 with the confirmed notes free, and without
// candidates, or after a skip in words, the image is sent at once. The classifier
// runs under the host's usage limit.

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

// Next week's Wednesday, the day the birthday falls on.
const week = nextWeekRange(TIMEZONE, new Date());
const BIRTHDAY_DAY = addDays(week.weekStart, 2);

function events(withNotes: boolean): FakeEvent[] {
  const notes: FakeEvent[] = withNotes
    ? [{ id: "mom-birthday", status: "confirmed", summary: "엄마 생일", start: { date: BIRTHDAY_DAY }, end: { date: addDays(BIRTHDAY_DAY, 1) }, updated: "2026-10-01T00:00:00.000Z" }]
    : [];
  // A meeting with a guest next Monday: never a candidate.
  const meeting: FakeEvent = {
    id: "client-call", status: "confirmed", summary: "Client call",
    start: { dateTime: `${week.weekStart}T10:00:00+09:00` }, end: { dateTime: `${week.weekStart}T11:00:00+09:00` },
    attendees: [{ email: "guest@example.test", responseStatus: "accepted" }], updated: "2026-10-01T00:00:00.000Z",
  };
  return [...notes, meeting];
}

async function turn(host: SeededHost, sender: string, text: string, channel: "imessage" | "whatsapp" = "imessage"): Promise<SetupToolCall> {
  expect((await im.deliver({ channel, sender, text })).outcome).toBe("forwarded");
  const [input] = await db<{ id: string }[]>`select id from app.conversation_inputs where discussion_id = ${host.discussionId} order by accepted_at desc, id desc limit 1`;
  await db`update app.agent_sessions set current_input_id = ${input!.id} where session_id = ${host.sessionId}`;
  return { auth: { principalId: host.hostAccountId, principalType: "user", attributes: { audience: "host_setup" } }, sessionId: host.sessionId, callId: randomUUID() };
}

const analysis = (classify: NoteClassifierModel | undefined = standInNoteClassifier) =>
  createCalendarAnalysisHandler(() => ({ classify, config: deps.calendar.config, tokenKeys: deps.calendar.tokenKeys }));

async function analysisJob(hostAccountId: string) {
  const [job] = await db<{ id: string }[]>`
    select j.id from app.jobs j join app.calendar_analyses a on a.id::text = j.payload ->> 'analysisId'
    where a.host_account_id = ${hostAccountId} order by a.created_at desc limit 1
  `;
  return job!.id;
}

// A linked host whose scan finished and who answered hours and place (online).
async function placeAnswered(options: { notes?: boolean; channel?: "imessage" | "whatsapp" } = {}) {
  const host = await seedHost(db, deps, google, { displayName: "Host" });
  google.setFixture(host.refreshToken, { calendars: host.calendars, events: { [host.primaryId]: events(options.notes ?? true) } });
  const { sender } = await im.link(host.hostAccountId, undefined, options.channel ?? "imessage");
  await runJob(db, await analysisJob(host.hostAccountId), analysis());
  const call = await turn(host, sender, "Weekdays 9 to 6 are fine, and online only please", options.channel ?? "imessage");
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

async function noteLinks(hostAccountId: string) {
  return db<{ id: string }[]>`select id from app.imessage_outbox where host_account_id = ${hostAccountId} and dedupe_key like 'onboarding-notes:%'`;
}

async function images(hostAccountId: string) {
  return db<{ id: string; review_hash: string }[]>`select id, review_hash from app.imessage_outbox where host_account_id = ${hostAccountId} and kind = 'image' order by created_at`;
}

async function imageJobs(hostAccountId: string) {
  return db<{ id: string }[]>`select id from app.jobs where kind = ${ONBOARDING_SLOT_IMAGE_JOB} and payload ->> 'hostAccountId' = ${hostAccountId} and payload ->> 'waited' is null`;
}

async function sentImage(outboxId: string) {
  const { sent } = await im.send(outboxId, { ...im.sendDeps(), tokenKeys: deps.calendar.tokenKeys });
  const content = sent[0]?.content as { kind: string; preview: SlotPreview } | undefined;
  expect(content?.kind).toBe("image");
  return content!.preview;
}

const openOn = (preview: SlotPreview, date: string) => preview.days.find(day => day.date === date)!.open;

function confirm(hostAccountId: string, input: { analysisId: string; choices: { key: string; decision: "free" | "keep_busy" }[] }, retryKey = randomUUID()) {
  return runCommand(hostCommandDeps(db, hostAccountId), confirmNoteReviewCommand, { input, resourceId: hostAccountId, retryKey });
}

describe("the note step after the place answer", () => {
  it("sends the review link, holds the image until 확인, then sends it with the confirmed note free", async () => {
    const { call, host, sender } = await placeAnswered();

    const first = await previewNextWeekForTool(deps, { ...call, callId: randomUUID() });
    expect(first).toMatchObject({ queued: false, noteReviewSent: true });
    expect(await images(host.hostAccountId)).toHaveLength(0);
    const [link] = await noteLinks(host.hostAccountId);
    expect(link).toBeDefined();
    const { sent } = await im.send(link!.id, { ...im.sendDeps(), tokenKeys: deps.calendar.tokenKeys });
    expect(sent[0]?.content).toMatchObject({ kind: "text", text: channelReplies("en").onboarding.noteReviewLink(1, `${deps.appOrigin}/app/notes`) });

    // Asked again while the chat waits, the tool sends nothing new.
    expect(await previewNextWeekForTool(deps, { ...call, callId: randomUUID() })).toMatchObject({ queued: false, waitingForNoteReview: true });
    expect(await noteLinks(host.hostAccountId)).toHaveLength(1);
    expect(await images(host.hostAccountId)).toHaveLength(0);
    expect(await slotImageWaits(db, host.hostAccountId)).toBe(true);

    const review = await readNoteReview(db, host.hostAccountId);
    const birthday = review.items.find(item => item.title === "엄마 생일")!;
    expect(birthday).toMatchObject({ verdict: "note", decision: null });
    const retryKey = randomUUID();
    const confirmed = await confirm(host.hostAccountId, { analysisId: review.analysisId!, choices: [{ key: birthday.key, decision: "free" }] }, retryKey);
    expect(confirmed).toMatchObject({ ok: true, result: { slotImage: true } });
    // A replayed 확인 and a second one with nothing changed queue the same job.
    expect(await confirm(host.hostAccountId, { analysisId: review.analysisId!, choices: [{ key: birthday.key, decision: "free" }] }, retryKey)).toMatchObject({ ok: true });
    expect(await confirm(host.hostAccountId, { analysisId: review.analysisId!, choices: [] })).toMatchObject({ ok: true, result: { slotImage: true } });
    const jobs = await imageJobs(host.hostAccountId);
    expect(jobs).toHaveLength(1);
    expect(await images(host.hostAccountId)).toHaveLength(0);

    // The writeback is still pending; the image already shows the birthday free.
    const [decision] = await db<{ writeback_state: string }[]>`select writeback_state from app.calendar_note_decisions where host_account_id = ${host.hostAccountId}`;
    expect(decision!.writeback_state).toBe("pending");
    expect(await runJob(db, jobs[0]!.id, createOnboardingSlotImageHandler(() => deps))).toBe("completed");
    const [image] = await images(host.hostAccountId);
    const proposal = await computeSetupProposal(db, host.hostAccountId);
    expect(image!.review_hash).toBe(proposal!.proposalHash);
    const preview = await sentImage(image!.id);
    expect(openOn(preview, BIRTHDAY_DAY).length).toBeGreaterThan(0);
    expect(await slotImageWaits(db, host.hostAccountId)).toBe(false);

    // 확인 after the image went out sends no second image.
    expect(await confirm(host.hostAccountId, { analysisId: review.analysisId!, choices: [] })).toMatchObject({ ok: true, result: { slotImage: false } });
    expect(await imageJobs(host.hostAccountId)).toHaveLength(1);

    // The host's yes to that image saves the settings.
    const yes = await turn(host, sender, "Yes, open those");
    expect(await confirmSettingsForTool(deps, yes, { reviewRef: settingsRef(proposal!.proposalHash) })).toMatchObject({ saved: true });
  });

  it("keeps an unconfirmed note busy in the image of a skipped review", async () => {
    const { call, host } = await placeAnswered();
    expect(await previewNextWeekForTool(deps, { ...call, callId: randomUUID() })).toMatchObject({ noteReviewSent: true });

    const skipped = await previewNextWeekForTool(deps, { ...call, callId: randomUUID() }, { skipNoteReview: true });
    expect(skipped).toMatchObject({ queued: true, reviewRef: expect.any(String) });
    const [image] = await images(host.hostAccountId);
    expect(openOn(await sentImage(image!.id), BIRTHDAY_DAY)).toEqual([]);
    expect(await slotImageWaits(db, host.hostAccountId)).toBe(false);

    // A later 확인 records the answer but sends no second image.
    const review = await readNoteReview(db, host.hostAccountId);
    const birthday = review.items.find(item => item.title === "엄마 생일")!;
    expect(await confirm(host.hostAccountId, { analysisId: review.analysisId!, choices: [{ key: birthday.key, decision: "free" }] })).toMatchObject({ ok: true, result: { slotImage: false } });
    expect(await imageJobs(host.hostAccountId)).toHaveLength(0);
    expect(await images(host.hostAccountId)).toHaveLength(1);
  });

  it("sends the image at once, with no link, when the scan has no candidates", async () => {
    const { call, host } = await placeAnswered({ notes: false });
    expect(await previewNextWeekForTool(deps, { ...call, callId: randomUUID() })).toMatchObject({ queued: true });
    expect(await noteLinks(host.hostAccountId)).toHaveLength(0);
    expect(await images(host.hostAccountId)).toHaveLength(1);
  });

  it("sends the image at once when every candidate is already answered", async () => {
    const { call, host } = await placeAnswered();
    const review = await readNoteReview(db, host.hostAccountId);
    expect(await confirm(host.hostAccountId, { analysisId: review.analysisId!, choices: review.items.map(item => ({ key: item.key, decision: "keep_busy" as const })) })).toMatchObject({ ok: true, result: { slotImage: false } });
    expect(await previewNextWeekForTool(deps, { ...call, callId: randomUUID() })).toMatchObject({ queued: true });
    expect(await noteLinks(host.hostAccountId)).toHaveLength(0);
  });

  it("sends nothing from a job whose chat was unlinked meanwhile", async () => {
    const { call, host } = await placeAnswered();
    await previewNextWeekForTool(deps, { ...call, callId: randomUUID() });
    const review = await readNoteReview(db, host.hostAccountId);
    expect(await confirm(host.hostAccountId, { analysisId: review.analysisId!, choices: [] })).toMatchObject({ result: { slotImage: true } });
    expect(await runCommand(hostCommandDeps(db, host.hostAccountId), unlinkImessageCommand, { input: {}, resourceId: host.hostAccountId, retryKey: randomUUID() })).toMatchObject({ ok: true });
    const [job] = await imageJobs(host.hostAccountId);
    expect(await runJob(db, job!.id, createOnboardingSlotImageHandler(() => deps))).toBe("completed");
    expect(await images(host.hostAccountId)).toHaveLength(0);
  });
});

describe("a review left unanswered (design 8)", () => {
  async function waitJob(hostAccountId: string) {
    const [job] = await db<{ id: string; hours: number }[]>`
      select id, round(extract(epoch from (run_after - created_at)) / 3600)::int as hours from app.jobs
      where kind = ${ONBOARDING_SLOT_IMAGE_JOB} and payload ->> 'hostAccountId' = ${hostAccountId} and payload ->> 'waited' = 'true'
    `;
    return job!;
  }

  async function laterNotes(hostAccountId: string) {
    return db<{ id: string }[]>`select id from app.imessage_outbox where host_account_id = ${hostAccountId} and dedupe_key like 'onboarding-notes-later:%'`;
  }

  it("sends the image with the notes busy after a day without 확인 or a skip, once, with one line on choosing later", async () => {
    const { call, host } = await placeAnswered();
    expect(await previewNextWeekForTool(deps, { ...call, callId: randomUUID() })).toMatchObject({ noteReviewSent: true });
    const job = await waitJob(host.hostAccountId);
    expect(job.hours).toBe(24);
    // The day has passed: the worker runs the job.
    expect(await runJob(db, job.id, createOnboardingSlotImageHandler(() => deps))).toBe("completed");
    const [image] = await images(host.hostAccountId);
    expect(openOn(await sentImage(image!.id), BIRTHDAY_DAY)).toEqual([]);
    expect(await slotImageWaits(db, host.hostAccountId)).toBe(false);

    const [later] = await laterNotes(host.hostAccountId);
    const { sent } = await im.send(later!.id, { ...im.sendDeps(), tokenKeys: deps.calendar.tokenKeys });
    expect(sent[0]?.content).toMatchObject({ kind: "text", text: channelReplies("en").onboarding.noteReviewLater(`${deps.appOrigin}/app/notes`) });

    // A 확인 after that records the answer and sends no second image.
    const review = await readNoteReview(db, host.hostAccountId);
    const birthday = review.items.find(item => item.title === "엄마 생일")!;
    expect(await confirm(host.hostAccountId, { analysisId: review.analysisId!, choices: [{ key: birthday.key, decision: "free" }] })).toMatchObject({ ok: true, result: { slotImage: false } });
    expect(await images(host.hostAccountId)).toHaveLength(1);
  });

  it("sends nothing after the wait once 확인 sent the image", async () => {
    const { call, host } = await placeAnswered();
    await previewNextWeekForTool(deps, { ...call, callId: randomUUID() });
    const review = await readNoteReview(db, host.hostAccountId);
    expect(await confirm(host.hostAccountId, { analysisId: review.analysisId!, choices: [] })).toMatchObject({ result: { slotImage: true } });
    const [confirmed] = await imageJobs(host.hostAccountId);
    expect(await runJob(db, confirmed!.id, createOnboardingSlotImageHandler(() => deps))).toBe("completed");

    expect(await runJob(db, (await waitJob(host.hostAccountId)).id, createOnboardingSlotImageHandler(() => deps))).toBe("completed");
    expect(await images(host.hostAccountId)).toHaveLength(1);
    expect(await laterNotes(host.hostAccountId)).toHaveLength(0);
  });

  it("sends nothing after the wait once a skip in words sent the image", async () => {
    const { call, host } = await placeAnswered();
    await previewNextWeekForTool(deps, { ...call, callId: randomUUID() });
    expect(await previewNextWeekForTool(deps, { ...call, callId: randomUUID() }, { skipNoteReview: true })).toMatchObject({ queued: true });
    expect(await runJob(db, (await waitJob(host.hostAccountId)).id, createOnboardingSlotImageHandler(() => deps))).toBe("completed");
    expect(await images(host.hostAccountId)).toHaveLength(1);
    expect(await laterNotes(host.hostAccountId)).toHaveLength(0);
  });

  it("waits 23 hours on WhatsApp, so the image leaves inside the window", async () => {
    const { call, host } = await placeAnswered({ channel: "whatsapp" });
    expect(await previewNextWeekForTool(deps, { ...call, callId: randomUUID() })).toMatchObject({ noteReviewSent: true });
    const job = await waitJob(host.hostAccountId);
    expect(job.hours).toBe(23);
    expect(await runJob(db, job.id, createOnboardingSlotImageHandler(() => deps))).toBe("completed");
    const [image] = await images(host.hostAccountId);
    const { sent } = await im.send(image!.id, { ...im.sendDeps(), tokenKeys: deps.calendar.tokenKeys });
    expect(sent[0]).toMatchObject({ channel: "whatsapp", content: { kind: "image" } });
  });
});

describe("the classifier's usage limit", () => {
  it("reserves each call, settles reported usage and refuses after ten calls a day", async () => {
    const host = await seedHost(db, deps, google);
    let calls = 0;
    const model: NoteClassifierModel = async (items, options) => {
      calls += 1;
      options.onUsage?.({ cachedInputTokens: 0, inputTokens: 1000, modelId: "gpt-5.6-terra", outputTokens: 500 });
      return items.map(item => ({ id: item.id, reason_en: "", reason_ko: "", verdict: "unsure" }));
    };
    const limited = limitNoteClassifier(model, host.hostAccountId, () => db);
    const item = { id: "c1", title: "x", allDay: true, weekday: null, startTime: null, durationMinutes: null, durationDays: 1, repeats: false, hasLocation: false, hasConferenceLink: false };
    for (let index = 0; index < MODEL_LIMITS.noteClassifierAttempts; index += 1) await limited([item], {});
    await expect(limited([item], {})).rejects.toBeInstanceOf(ModelLimitError);
    expect(calls).toBe(MODEL_LIMITS.noteClassifierAttempts);
    const rows = await db<{ amount_usd: string }[]>`
      select amount_usd::text from app.model_reservations where work_kind = 'note_classification' and work_id = ${host.hostAccountId}
    `;
    expect(rows).toHaveLength(MODEL_LIMITS.noteClassifierAttempts);
    // 1,000 input tokens at USD 2 and 500 output tokens at USD 12 per million.
    expect(rows.every(row => Number(row.amount_usd) === 0.008)).toBe(true);
  });

  it("lists the scan's candidates as unsure once the limit is spent", async () => {
    const host = await seedHost(db, deps, google);
    google.setFixture(host.refreshToken, { calendars: host.calendars, events: { [host.primaryId]: events(true) } });
    await db`
      insert into app.model_reservations (work_kind, work_id, principal_type, principal_id, amount_usd, window_start)
      select 'note_classification', ${host.hostAccountId}, 'host_account', ${host.hostAccountId}, 0.01,
             date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00')
      from generate_series(1, ${MODEL_LIMITS.noteClassifierAttempts})
    `;
    await im.link(host.hostAccountId);
    await runJob(db, await analysisJob(host.hostAccountId), analysis());
    const review = await readNoteReview(db, host.hostAccountId);
    expect(review.items.find(item => item.title === "엄마 생일")).toMatchObject({ verdict: "unsure", decision: null });
  });
});
