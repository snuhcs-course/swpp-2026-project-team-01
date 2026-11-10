import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCalendarAnalysisHandler, hoursSuggestion } from "../../lib/server/analysis";
import { readCalendarRoles } from "../../lib/server/calendar-roles";
import { channelReplies } from "../../lib/server/channel-texts";
import { runCommand } from "../../lib/server/commands";
import { resumeImessageOnboarding } from "../../lib/server/imessage-links";
import { computeSetupProposal } from "../../lib/server/setup";
import { confirmSettingsForTool, previewNextWeekForTool, setCalendarRolesForTool } from "../../lib/server/setup-channel-tools";
import { draftSettingsForTool, modelProjection, readSetupStateForTool, type SetupToolCall } from "../../lib/server/setup-tools";
import { settingsRef } from "../../lib/server/request-ref";
import { readSetupState } from "../../lib/server/setup";
import { testDatabase } from "./support/database";
import { startFakeGoogle, type FakeGoogle } from "./support/fake-google";
import { startFakePhoton, type FakePhoton } from "./support/fake-photon";
import { imessageHarness } from "./support/imessage";
import { runJob, testTokenKey } from "./support/requests";
import { seedHost, setupDependencies, type SeededHost } from "./support/setup-host";
import { setUpManuallyCommand } from "../../lib/server/analysis";

const db = testDatabase();
let google: FakeGoogle;
let photon: FakePhoton;
let deps: ReturnType<typeof setupDependencies>;
const im = imessageHarness(db, () => photon, { receipt: () => ({ setup: deps }) });

beforeAll(async () => {
  google = await startFakeGoogle();
  photon = await startFakePhoton();
  const setup = setupDependencies(db, google);
  deps = { ...setup, calendar: { ...setup.calendar, tokenKeys: [setup.tokenKey, testTokenKey] } };
});
afterAll(async () => { await google.close(); await photon.close(); await db.end(); });

async function turn(host: SeededHost, sender: string, text: string, channel: "imessage" | "whatsapp" = "imessage"): Promise<SetupToolCall> {
  expect((await im.deliver({ sender, text, channel })).outcome).toBe("forwarded");
  const [input] = await db<{ id: string }[]>`select id from app.conversation_inputs where discussion_id = ${host.discussionId} order by accepted_at desc, id desc limit 1`;
  await db`update app.agent_sessions set current_input_id = ${input!.id} where session_id = ${host.sessionId}`;
  return { auth: { principalId: host.hostAccountId, principalType: "user", attributes: { audience: "host_setup" } }, sessionId: host.sessionId, callId: randomUUID() };
}

async function analysisJob(host: SeededHost) {
  const [job] = await db<{ id: string }[]>`select j.id from app.jobs j join app.calendar_analyses a on a.id::text = j.payload ->> 'analysisId' where a.host_account_id = ${host.hostAccountId} order by a.created_at desc limit 1`;
  return job!.id;
}
const handler = () => createCalendarAnalysisHandler(() => ({ config: deps.calendar.config, tokenKeys: deps.calendar.tokenKeys }));

async function reviewable(channel: "imessage" | "whatsapp" = "imessage") {
  const host = await seedHost(db, deps, google, { displayName: "Host" });
  const { sender } = await im.link(host.hostAccountId, undefined, channel);
  const call = await turn(host, sender, "Online only, please", channel);
  const commandDeps = { db, authenticate: async () => ({ kind: "host_account" as const, id: host.hostAccountId }) };
  expect((await runCommand(commandDeps, setUpManuallyCommand, { input: {}, resourceId: host.hostAccountId, retryKey: randomUUID() })).ok).toBe(true);
  const state = await readSetupStateForTool(deps, call);
  expect(await draftSettingsForTool(deps, { ...call, callId: randomUUID() }, { expectedRevision: state.draftRevision, values: { meetingMode: { source: "stated", value: "online" } } })).toMatchObject({ changed: true });
  return { host, sender, call, channel };
}

async function sendPreview(call: SetupToolCall, host: SeededHost) {
  const result = await previewNextWeekForTool(deps, { ...call, callId: randomUUID() });
  expect(result).toMatchObject({ queued: true, reviewRef: expect.any(String), ranges: expect.stringContaining(":") });
  const [image] = await im.outbox({ hostAccountId: host.hostAccountId, kind: "image" });
  expect(image).toBeDefined();
  await im.send(image!.id, { ...im.sendDeps(), tokenKeys: deps.calendar.tokenKeys });
  return image!.id;
}

describe("default calendar roles", () => {
  it.each(["imessage", "whatsapp"] as const)("saves a writable primary at %s link confirmation and publishes analysis", async channel => {
    const host = await seedHost(db, deps, google);
    await im.link(host.hostAccountId, undefined, channel);
    expect(await readCalendarRoles(db, host.hostAccountId)).toMatchObject({ revision: 1, bookingCalendar: { id: host.primaryId }, conflictCalendars: [{ id: host.primaryId }] });
    expect(await analysisJob(host)).toBeTruthy();
    const [welcome] = await im.outbox({ hostAccountId: host.hostAccountId, kind: "linked" });
    const { sent } = await im.send(welcome!.id);
    expect(sent[0]?.content).toMatchObject({ kind: "text", text: channelReplies("en").onboarding.rolesDefault("Me") });
  });

  it("asks for roles for a read-only primary without choosing another calendar", async () => {
    const host = await seedHost(db, deps, google, { calendars: [{ id: "readonly", summary: "Shared", primary: true, accessRole: "reader" }] });
    await im.link(host.hostAccountId);
    expect(await readCalendarRoles(db, host.hostAccountId)).toBeNull();
    const [welcome] = await im.outbox({ hostAccountId: host.hostAccountId, kind: "linked" });
    expect((await im.send(welcome!.id)).sent[0]?.content).toMatchObject({ text: channelReplies("en").onboarding.rolesNeeded });
  });

  it("confirms the link and asks for roles when the grant cannot be decrypted", async () => {
    const host = await seedHost(db, setupDependencies(db, google), google);
    await im.link(host.hostAccountId);
    expect(await im.bindingOf(host.hostAccountId)).toMatchObject({ state: "active" });
    expect(await readCalendarRoles(db, host.hostAccountId)).toBeNull();
    const [welcome] = await im.outbox({ hostAccountId: host.hostAccountId, kind: "linked" });
    expect((await im.send(welcome!.id)).sent[0]?.content).toMatchObject({ text: channelReplies("en").onboarding.rolesNeeded });

    await resumeImessageOnboarding(db, testTokenKey, host.hostAccountId, "unreadable-grant", deps.calendar);
    const [resume] = await im.outbox({ hostAccountId: host.hostAccountId, kind: "command" });
    expect((await im.send(resume!.id)).sent[0]?.content).toMatchObject({ text: channelReplies("en").onboarding.rolesNeeded });
    expect(await readCalendarRoles(db, host.hostAccountId)).toBeNull();
  });

  it("defaults on return from Google and replays once", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });
    await im.link(host.hostAccountId);
    // Install the grant exactly as consent does, then return through the callback helper.
    const { recordGoogleGrant } = await import("../../lib/server/provider-grants");
    const { GOOGLE_CALENDAR_SCOPES } = await import("../../lib/contracts/google-scopes");
    await recordGoogleGrant(db, deps.tokenKey, { hostAccountId: host.hostAccountId, refreshToken: host.refreshToken, grantedScopes: [...GOOGLE_CALENDAR_SCOPES] });
    google.setFixture(host.refreshToken, { calendars: host.calendars, events: {} });
    for (let attempt = 0; attempt < 2; attempt++) await resumeImessageOnboarding(db, testTokenKey, host.hostAccountId, "same-code", deps.calendar);
    expect((await readCalendarRoles(db, host.hostAccountId))?.revision).toBe(1);
    const rows = await db`select id from app.imessage_outbox where host_account_id = ${host.hostAccountId} and dedupe_key like 'google-return:%'`;
    expect(rows).toHaveLength(1);
  });
});

describe("calendar roles in words", () => {
  it("adds a live calendar but refuses a read-only destination and a web turn", async () => {
    const { host, sender } = await reviewable();
    const call = await turn(host, sender, "Check Team as well");
    const state = modelProjection((await readSetupState(deps, host.hostAccountId, { includeCalendars: true }))!);
    const calendars = state.calendar.calendars!;
    const primary = { index: 0, name: calendars[0]!.name };
    const shared = { index: 1, name: calendars[1]!.name };
    expect(await setCalendarRolesForTool(deps, call, { conflictCalendars: [primary, shared], bookingCalendar: primary })).toMatchObject({ saved: true });
    expect((await readCalendarRoles(db, host.hostAccountId))?.conflictCalendars).toHaveLength(2);
    const revision = (await readCalendarRoles(db, host.hostAccountId))!.revision;
    expect(await setCalendarRolesForTool(deps, { ...call, callId: randomUUID() }, { conflictCalendars: [primary], bookingCalendar: shared })).toMatchObject({ saved: false });
    expect((await readCalendarRoles(db, host.hostAccountId))?.revision).toBe(revision);
    await db`update app.agent_sessions set current_input_id = null where session_id = ${host.sessionId}`;
    expect(await setCalendarRolesForTool(deps, { ...call, callId: randomUUID() }, { conflictCalendars: [primary], bookingCalendar: primary })).toMatchObject({ saved: false });
  });
});

describe("hours question", () => {
  it.each(["en", "ko"] as const)("sends once in %s when done, including a replay", async language => {
    const host = await seedHost(db, deps, google);
    const { sender } = await im.link(host.hostAccountId);
    await turn(host, sender, language === "ko" ? "안녕하세요" : "Hello");
    const jobId = await analysisJob(host);
    await runJob(db, jobId, handler());
    await db`update app.calendar_analyses set state = 'pending', evidence = null, completed_at = null where host_account_id = ${host.hostAccountId}`;
    await db`update app.jobs set state = 'pending', completed_at = null where id = ${jobId}`;
    await runJob(db, jobId, handler());
    const notices = await db<{ id: string }[]>`select id from app.imessage_outbox where host_account_id = ${host.hostAccountId} and dedupe_key like 'onboarding-hours:%'`;
    expect(notices).toHaveLength(1);
    expect((await im.send(notices[0]!.id, { ...im.sendDeps(), tokenKeys: deps.calendar.tokenKeys })).sent[0]?.content).toMatchObject({ text: channelReplies(language).onboarding.hoursQuestion(hoursSuggestion(null)) });
  });

  it("sends the inferred hours after a completed scan of located appointments", async () => {
    const host = await seedHost(db, deps, google);
    await im.link(host.hostAccountId);
    google.setFixture(host.refreshToken, { calendars: host.calendars, events: { [host.primaryId]: [2, 3, 4, 5, 6].map(day => ({
      id: `appointment-${day}`, start: { dateTime: `2026-11-0${day}T00:30:00Z` }, end: { dateTime: `2026-11-0${day}T12:30:00Z` }, location: "Station",
    })) } });
    await runJob(db, await analysisJob(host), handler());
    const [notice] = await db<{ id: string }[]>`select id from app.imessage_outbox where host_account_id = ${host.hostAccountId} and dedupe_key like 'onboarding-hours:%'`;
    expect((await im.send(notice!.id, { ...im.sendDeps(), tokenKeys: deps.calendar.tokenKeys })).sent[0]?.content).toMatchObject({ text: channelReplies("en").onboarding.hoursQuestion({ weekdays: { start: "09:00", end: "22:00" }, weekend: [], source: "inferred", sampleSize: 5 }) });
  });

  it("uses the starter default after a failed analysis", async () => {
    const host = await seedHost(db, deps, google);
    await im.link(host.hostAccountId);
    await db`update app.provider_grants set invalidated_at = now() where host_account_id = ${host.hostAccountId}`;
    await runJob(db, await analysisJob(host), handler());
    const [notice] = await db<{ id: string }[]>`select id from app.imessage_outbox where host_account_id = ${host.hostAccountId} and dedupe_key like 'onboarding-hours:%'`;
    expect(notice).toBeDefined();
    expect((await im.send(notice!.id, { ...im.sendDeps(), tokenKeys: deps.calendar.tokenKeys })).sent[0]?.content).toMatchObject({ text: channelReplies("en").onboarding.hoursQuestion(hoursSuggestion(null)) });
  });
});

describe("slot preview and acceptance", () => {
  it.each(["imessage", "whatsapp"] as const)("sends %s image data through the stand-in and accepts stated answers only after delivery", async channel => {
    const { host, sender, call } = await reviewable(channel);
    const ref = settingsRef((await computeSetupProposal(db, host.hostAccountId))!.proposalHash);
    expect(await confirmSettingsForTool(deps, { ...call, callId: randomUUID() }, { reviewRef: ref })).toMatchObject({ saved: false });
    await sendPreview(call, host);
    const image = photon.sends.find(send => send.content.kind === "image" && send.content.preview.reviewRef === ref && send.channel === channel);
    expect(image?.content).toMatchObject({ kind: "image", language: "en", preview: { meetingMode: "online", reviewRef: ref, days: expect.any(Array) } });
    const yes = await turn(host, sender, "Yes, open those", channel);
    expect(await confirmSettingsForTool(deps, yes, { reviewRef: ref })).toMatchObject({ saved: true, links: { booking: expect.any(String) } });
    const [draft] = await db<{ accepted: boolean }[]>`select (fields -> 'meetingMode' ->> 'accepted')::boolean as accepted from app.setup_drafts where host_account_id = ${host.hostAccountId}`;
    expect(draft!.accepted).toBe(true);
  });

  it("blocks an unsent preview, a changed place after an image, and all three actions from a web turn", async () => {
    const { host, sender, call } = await reviewable();
    const state = await readSetupStateForTool(deps, call);
    await draftSettingsForTool(deps, { ...call, callId: randomUUID() }, { expectedRevision: state.draftRevision, values: {
      meetingMode: { value: "in_person", source: "stated" }, location: { value: { kind: "places", areas: ["강남역"], venue: null }, source: "stated" }, travelMode: { value: "transit", source: "stated" },
    } });
    const ref = settingsRef((await computeSetupProposal(db, host.hostAccountId))!.proposalHash);
    expect(await previewNextWeekForTool(deps, { ...call, callId: randomUUID() })).toMatchObject({ queued: true });
    expect(await confirmSettingsForTool(deps, { ...call, callId: randomUUID() }, { reviewRef: ref })).toMatchObject({ saved: false });
    const [image] = await im.outbox({ hostAccountId: host.hostAccountId, kind: "image" });
    await im.send(image!.id, { ...im.sendDeps(), tokenKeys: deps.calendar.tokenKeys });
    const change = await turn(host, sender, "Use 역삼역 instead");
    const current = await readSetupStateForTool(deps, change);
    await draftSettingsForTool(deps, change, { expectedRevision: current.draftRevision, values: { location: { value: { kind: "places", areas: ["역삼역"], venue: null }, source: "stated" } } });
    const changedRef = settingsRef((await computeSetupProposal(db, host.hostAccountId))!.proposalHash);
    expect(changedRef).not.toBe(ref);
    expect(await confirmSettingsForTool(deps, { ...change, callId: randomUUID() }, { reviewRef: changedRef })).toMatchObject({ saved: false });
    await db`update app.agent_sessions set current_input_id = null where session_id = ${host.sessionId}`;
    expect(await previewNextWeekForTool(deps, { ...change, callId: randomUUID() })).toMatchObject({ queued: false });
    expect(await confirmSettingsForTool(deps, { ...change, callId: randomUUID() }, { reviewRef: changedRef })).toMatchObject({ saved: false });
    expect(await db`select host_account_id from app.host_settings where host_account_id = ${host.hostAccountId}`).toHaveLength(0);
  });
});
