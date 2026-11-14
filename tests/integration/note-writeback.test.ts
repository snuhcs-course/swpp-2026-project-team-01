import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeAgainCommand, createCalendarAnalysisHandler, readLatestAnalysis } from "../../lib/server/analysis";
import { saveCalendarRolesCommand } from "../../lib/server/calendar-roles";
import { runCommand } from "../../lib/server/commands";
import { normalizeBusy } from "../../lib/server/feasibility";
import { openHostCalendar } from "../../lib/server/google-calendar";
import {
  decideNotesCommand,
  createNoteWritebackHandler,
  NOTE_WRITEBACK_JOB,
  type NoteDecisionItem,
  retryNoteWritebackCommand,
  withNoteDecisionExclusions,
} from "../../lib/server/note-decisions";
import { standInNoteClassifier } from "../../lib/server/note-classifier-stand-in";
import { buildNoteReview, confirmNoteReviewCommand, readNoteReview, readNoteWeek } from "../../lib/server/note-review";
import type { CalendarRef } from "../../lib/contracts/setup";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { analysisJobs, createCalendarHost, fakeGoogleConfig, hostCommandDeps, runJob } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { type FakeEvent, type FakeGoogle, type FakeGoogleFixture, type PatchBehavior, startFakeGoogle } from "./support/fake-google";

// Writing confirmed notes back to Google Calendar (calendar-note-review tasks 2.1
// to 2.4), through the real Calendar client against the Google stand-in.

const db = testDatabase();
const key = parseTokenKey(randomBytes(32).toString("base64"));
const BIRTHDAYS = "birthdays@group.v.calendar.google.com";
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

const DAY = 86_400_000;
const date = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const at = (offsetDays: number, hours: number) => `${date(offsetDays)}T${String(hours).padStart(2, "0")}:00:00.000Z`;

function timed(id: string, offsetDays: number, extra: Partial<FakeEvent> = {}): FakeEvent {
  return {
    end: { dateTime: at(offsetDays, 11) },
    id,
    start: { dateTime: at(offsetDays, 10) },
    status: "confirmed",
    summary: id,
    updated: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

function allDay(id: string, offsetDays: number, extra: Partial<FakeEvent> = {}): FakeEvent {
  return { ...timed(id, offsetDays, extra), end: { date: date(offsetDays + 1) }, start: { date: date(offsetDays) }, ...extra };
}

// The weekly "분리수거" series on the primary calendar, whose occurrences Google
// gave different updated times, and a yearly birthday on a subscribed calendar.
function fixture(email: string, patchBehavior?: readonly PatchBehavior[]): FakeGoogleFixture {
  return {
    calendars: [
      { accessRole: "owner", id: email, primary: true, summary: email, timeZone: "Asia/Seoul" },
      { accessRole: "reader", id: BIRTHDAYS, summary: "Birthdays", timeZone: "Asia/Seoul" },
    ],
    events: {
      [email]: [
        allDay("mom-birthday", 3, { summary: "엄마 생일" }),
        timed("recycling_1", 2, { recurringEventId: "recycling", summary: "분리수거", updated: "2026-10-05T00:00:00.000Z" }),
        timed("recycling_2", 9, { recurringEventId: "recycling", summary: "분리수거", updated: "2026-09-20T00:00:00.000Z" }),
        timed("recycling_3", 16, { recurringEventId: "recycling", summary: "분리수거", updated: "2026-10-05T00:00:00.000Z" }),
        timed("gym", 4, { summary: "헬스" }),
      ],
      [BIRTHDAYS]: [
        allDay("dad_2026", 5, { recurringEventId: "dad", summary: "아빠 생일", updated: "2026-10-01T00:00:00.000Z" }),
        allDay("dad_2027", 370, { recurringEventId: "dad", summary: "아빠 생일", updated: "2026-08-01T00:00:00.000Z" }),
      ],
    },
    ...(patchBehavior ? { patchBehavior: { [email]: patchBehavior } } : {}),
  };
}

async function host(patchBehavior?: readonly PatchBehavior[]) {
  const created = await createCalendarHost(db, key);
  google.setFixture(created.refreshToken!, fixture(created.email, patchBehavior));
  const live = (await (await openHostCalendar(calendarDeps(), created.hostAccountId)).listCalendars()).calendars;
  const saved = await runCommand(hostCommandDeps(db, created.hostAccountId), saveCalendarRolesCommand(live), {
    expectedRevision: null,
    input: { bookingCalendarId: created.email, conflictCalendarIds: [created.email, BIRTHDAYS] },
    resourceId: created.hostAccountId,
    retryKey: randomUUID(),
  });
  if (!saved.ok) throw new Error(`Saving roles failed: ${saved.error.category}`);
  return created;
}

function calendarDeps() {
  return { config: fakeGoogleConfig(google), db, tokenKeys: [key] };
}

const writeback = () => createNoteWritebackHandler(() => ({ config: fakeGoogleConfig(google), tokenKeys: [key] }));

async function decide(hostAccountId: string, items: NoteDecisionItem[]) {
  const outcome = await runCommand(hostCommandDeps(db, hostAccountId), decideNotesCommand, {
    input: { items },
    resourceId: hostAccountId,
    retryKey: randomUUID(),
  });
  if (!outcome.ok) throw new Error(`Deciding failed: ${outcome.error.category}`);
  return outcome.result.decisions;
}

async function writebackJobs(decisionId: string) {
  return db<{ id: string; state: string; payload: { revision: number } }[]>`
    select id, state, payload from app.jobs where kind = ${NOTE_WRITEBACK_JOB} and payload ->> 'decisionId' = ${decisionId}
    order by created_at
  `;
}

async function decisionRow(decisionId: string) {
  const [row] = await db<{ writeback_state: string | null; writeback_failure: string | null; fingerprint: string; revision: number; decision: string }[]>`
    select writeback_state, writeback_failure, fingerprint, revision, decision from app.calendar_note_decisions where id = ${decisionId}
  `;
  return row!;
}

// The host's events as feasibility reads them, and which of them still block time.
async function busyIds(hostAccountId: string, calendarId: string, noteExclusions: Parameters<typeof normalizeBusy>[1]["noteExclusions"] = []) {
  const events = await (await openHostCalendar(calendarDeps(), hostAccountId)).listEvents(calendarId, {
    end: new Date(Date.now() + 400 * DAY),
    start: new Date(Date.now() - DAY),
  });
  const busy = normalizeBusy(events, { endpointKey: (text) => text, noteExclusions, selfEmail: null, timezone: "Asia/Seoul" });
  const remaining = new Set(busy.map((interval) => interval.start));
  return events
    .filter((event) => remaining.has(Date.parse(event.start.dateTime ?? `${event.start.date}T00:00:00+09:00`)))
    .map((event) => event.id);
}

const birthdayItem = (email: string, decision: "free" | "keep_busy" = "free"): NoteDecisionItem => ({
  calendarId: email,
  decision,
  end: date(4),
  eventId: "mom-birthday",
  fingerprint: "2026-10-01T00:00:00.000Z",
  scope: "occurrence",
  seriesId: null,
});

const recyclingItem = (email: string, decision: "free" | "keep_busy", scope: "series" | "occurrence" = "series"): NoteDecisionItem => ({
  calendarId: email,
  decision,
  eventId: "recycling_1",
  // The latest updated time of the occurrences the host saw.
  fingerprint: "2026-10-05T00:00:00.000Z",
  scope,
  seriesId: "recycling",
});

describe("note writeback", () => {
  it("keeps a confirmed note busy until Google marks it free, then frees it", async () => {
    const owner = await host();
    const [decision] = await decide(owner.hostAccountId, [birthdayItem(owner.email)]);

    expect(decision).toMatchObject({ decision: "free", eventId: "mom-birthday", writebackState: "pending" });
    // Recorded, not yet written: the time is still busy for guests.
    expect(await busyIds(owner.hostAccountId, owner.email)).toContain("mom-birthday");

    const [job] = await writebackJobs(decision!.id);
    expect(await runJob(db, job!.id, writeback())).toBe("completed");

    const patched = google.patched(owner.email, "mom-birthday");
    expect(patched?.transparency).toBe("transparent");
    // Google's updated time after our own change becomes the fingerprint.
    expect(await decisionRow(decision!.id)).toMatchObject({ fingerprint: patched!.updated, writeback_state: "done" });
    expect(await busyIds(owner.hostAccountId, owner.email)).not.toContain("mom-birthday");
  });

  it("keeps the time busy when Google refuses, shows the failure and retries on request", async () => {
    const owner = await host([{ status: 403 }, "applied"]);
    const [decision] = await decide(owner.hostAccountId, [birthdayItem(owner.email)]);
    const [job] = await writebackJobs(decision!.id);

    expect(await runJob(db, job!.id, writeback())).toBe("completed");
    expect(await decisionRow(decision!.id)).toMatchObject({ writeback_failure: "calendar_rejected", writeback_state: "failed" });
    expect(google.patched(owner.email, "mom-birthday")).toBeNull();
    expect(await busyIds(owner.hostAccountId, owner.email)).toContain("mom-birthday");

    const retried = await runCommand(hostCommandDeps(db, owner.hostAccountId), retryNoteWritebackCommand, {
      input: { decisionId: decision!.id },
      resourceId: owner.hostAccountId,
      retryKey: randomUUID(),
    });
    expect(retried.ok && retried.result.decision).toMatchObject({ revision: 2, writebackState: "pending" });
    const [, second] = await writebackJobs(decision!.id);
    expect(await runJob(db, second!.id, writeback())).toBe("completed");
    expect(await decisionRow(decision!.id)).toMatchObject({ writeback_failure: null, writeback_state: "done" });
    expect(await busyIds(owner.hostAccountId, owner.email)).not.toContain("mom-birthday");
  });

  it("retries a timed-out writeback as the same job and records the decision once", async () => {
    const owner = await host(["lost_before_patch", "applied"]);
    const [decision] = await decide(owner.hostAccountId, [birthdayItem(owner.email)]);
    const [job] = await writebackJobs(decision!.id);

    // The first attempt gets no answer: the job is retried and the time stays busy.
    expect(await runJob(db, job!.id, writeback())).toBe("failed");
    expect(await decisionRow(decision!.id)).toMatchObject({ writeback_state: "pending" });
    expect(await busyIds(owner.hostAccountId, owner.email)).toContain("mom-birthday");

    expect(await runJob(db, job!.id, writeback())).toBe("completed");
    expect(await decisionRow(decision!.id)).toMatchObject({ revision: 1, writeback_state: "done" });
    expect(await writebackJobs(decision!.id)).toHaveLength(1);
    const [{ count }] = await db<{ count: number }[]>`
      select count(*)::int as count from app.calendar_note_decisions where host_account_id = ${owner.hostAccountId}
    `;
    expect(count).toBe(1);
  });

  it("fails the decision when the retries run out", async () => {
    const owner = await host([{ status: 503 }]);
    const [decision] = await decide(owner.hostAccountId, [birthdayItem(owner.email)]);
    const [job] = await writebackJobs(decision!.id);
    await db`update app.jobs set max_attempts = 1 where id = ${job!.id}`;

    expect(await runJob(db, job!.id, writeback())).toBe("exhausted");
    expect(await decisionRow(decision!.id)).toMatchObject({ writeback_failure: "writeback_unavailable", writeback_state: "failed" });
  });

  it("changes nothing for a replayed decision or a job a newer decision replaced", async () => {
    const owner = await host();
    const [first] = await decide(owner.hostAccountId, [birthdayItem(owner.email)]);
    // The same decision again, as a retried request would send it.
    const [again] = await decide(owner.hostAccountId, [birthdayItem(owner.email)]);
    expect(again).toEqual(first);
    expect(await writebackJobs(first!.id)).toHaveLength(1);

    // The host changes their mind before the writeback ran.
    await decide(owner.hostAccountId, [birthdayItem(owner.email, "keep_busy")]);
    const [stale, current] = await writebackJobs(first!.id);
    expect(await runJob(db, stale!.id, writeback())).toBe("completed");
    expect(google.patched(owner.email, "mom-birthday")).toBeNull();

    expect(await runJob(db, current!.id, writeback())).toBe("completed");
    expect(google.patched(owner.email, "mom-birthday")?.transparency).toBe("opaque");
    expect(await busyIds(owner.hostAccountId, owner.email)).toContain("mom-birthday");
  });
});

describe("recurring notes", () => {
  it("frees the whole series by default", async () => {
    const owner = await host();
    const [decision] = await decide(owner.hostAccountId, [recyclingItem(owner.email, "free")]);
    expect(decision).toMatchObject({ eventId: "recycling", scope: "series" });

    const [job] = await writebackJobs(decision!.id);
    await runJob(db, job!.id, writeback());

    expect(google.patched(owner.email, "recycling")?.transparency).toBe("transparent");
    const busy = await busyIds(owner.hostAccountId, owner.email);
    expect(busy.filter((id) => id.startsWith("recycling"))).toEqual([]);
  });

  it("frees one occurrence when the host chooses it", async () => {
    const owner = await host();
    const [decision] = await decide(owner.hostAccountId, [recyclingItem(owner.email, "free", "occurrence")]);
    expect(decision).toMatchObject({ eventId: "recycling_1", scope: "occurrence" });

    const [job] = await writebackJobs(decision!.id);
    await runJob(db, job!.id, writeback());

    const busy = await busyIds(owner.hostAccountId, owner.email);
    expect(busy).not.toContain("recycling_1");
    expect(busy).toEqual(expect.arrayContaining(["recycling_2", "recycling_3"]));
  });

  it("undoes a freed series by patching it back to opaque", async () => {
    const owner = await host();
    const [freed] = await decide(owner.hostAccountId, [recyclingItem(owner.email, "free")]);
    await runJob(db, (await writebackJobs(freed!.id))[0]!.id, writeback());

    const [kept] = await decide(owner.hostAccountId, [recyclingItem(owner.email, "keep_busy")]);
    expect(kept).toMatchObject({ decision: "keep_busy", id: freed!.id, writebackState: "pending" });
    const [, undo] = await writebackJobs(freed!.id);
    expect(await runJob(db, undo!.id, writeback())).toBe("completed");

    expect(google.patched(owner.email, "recycling")?.transparency).toBe("opaque");
    expect(await decisionRow(freed!.id)).toMatchObject({ decision: "keep_busy", writeback_state: "done" });
    expect(await busyIds(owner.hostAccountId, owner.email)).toEqual(expect.arrayContaining(["recycling_1", "recycling_2", "recycling_3"]));
  });
});

describe("calendars the host cannot change", () => {
  const dadItem = (decision: "free" | "keep_busy"): NoteDecisionItem => ({
    calendarId: BIRTHDAYS,
    decision,
    end: date(6),
    eventId: "dad_2026",
    fingerprint: "2026-10-01T00:00:00.000Z",
    scope: "series",
    seriesId: "dad",
  });

  it("records a free decision only as a note exclusion, without calling Google", async () => {
    const owner = await host();
    await db`
      insert into app.host_settings (host_account_id, settings, draft_revision)
      values (${owner.hostAccountId}, ${db.json({ noteExclusions: [] })}, 1)
    `;
    const patchesBefore = google.requests.filter((request) => request.method === "PATCH").length;

    const [decision] = await decide(owner.hostAccountId, [dadItem("free")]);

    expect(decision).toMatchObject({ writebackState: "not_writable" });
    expect(await writebackJobs(decision!.id)).toEqual([]);
    expect(google.requests.filter((request) => request.method === "PATCH")).toHaveLength(patchesBefore);
    const [settings] = await db<{ exclusions: Parameters<typeof normalizeBusy>[1]["noteExclusions"] }[]>`
      select settings -> 'noteExclusions' as exclusions from app.host_settings where host_account_id = ${owner.hostAccountId}
    `;
    expect(settings!.exclusions).toEqual([{ calendarId: BIRTHDAYS, end: date(6), eventId: "dad", fingerprint: "2026-10-01T00:00:00.000Z", scope: "series" }]);
    // Both years are free, although Google gave them different updated times.
    expect(await busyIds(owner.hostAccountId, BIRTHDAYS, settings!.exclusions)).toEqual([]);

    // Kept busy again: the exclusion goes.
    await decide(owner.hostAccountId, [dadItem("keep_busy")]);
    const [after] = await db<{ exclusions: unknown[] }[]>`
      select settings -> 'noteExclusions' as exclusions from app.host_settings where host_account_id = ${owner.hostAccountId}
    `;
    expect(after!.exclusions).toEqual([]);
  });

  it("keeps the exclusion for Confirm and save when the host has no settings yet", async () => {
    const owner = await host();
    await decide(owner.hostAccountId, [dadItem("free")]);

    expect(await withNoteDecisionExclusions(db, owner.hostAccountId, [{ calendarId: owner.email, eventId: "x", fingerprint: "f" }])).toEqual([
      { calendarId: owner.email, eventId: "x", fingerprint: "f" },
      { calendarId: BIRTHDAYS, end: date(6), eventId: "dad", fingerprint: "2026-10-01T00:00:00.000Z", scope: "series" },
    ]);
  });

  it("refuses a decision about a calendar that is not a conflict calendar", async () => {
    const owner = await host();
    const outcome = await runCommand(hostCommandDeps(db, owner.hostAccountId), decideNotesCommand, {
      input: { items: [{ ...birthdayItem(owner.email), calendarId: "someone-else@example.test" }] },
      resourceId: owner.hostAccountId,
      retryKey: randomUUID(),
    });
    expect(outcome.ok).toBe(false);
  });
});

describe("remembered answers in the next scan", () => {
  it("does not list a series kept busy or freed on a subscribed calendar, whatever each occurrence's updated time", async () => {
    const owner = await host();
    await decide(owner.hostAccountId, [
      recyclingItem(owner.email, "keep_busy"),
      { calendarId: BIRTHDAYS, decision: "free", eventId: "dad_2026", fingerprint: "2026-10-01T00:00:00.000Z", scope: "series", seriesId: "dad" },
      { ...birthdayItem(owner.email, "keep_busy") },
    ]);

    const again = await runCommand(hostCommandDeps(db, owner.hostAccountId), analyzeAgainCommand, {
      input: {},
      resourceId: owner.hostAccountId,
      retryKey: randomUUID(),
    });
    if (!again.ok) throw new Error("Analyze again failed");
    const job = (await analysisJobs(db, owner.hostAccountId)).find((entry) => entry.payload.analysisId === again.result.analysisId)!;
    await runJob(db, job.id, createCalendarAnalysisHandler(() => ({ config: fakeGoogleConfig(google), tokenKeys: [key] })));

    const entries = (await readLatestAnalysis(db, owner.hostAccountId))!.evidence!.noteLike.entries;
    expect(entries.map((entry) => entry.eventId)).toEqual(["gym"]);
  });
});

describe("the note review", () => {
  async function scanned() {
    const owner = await host();
    const again = await runCommand(hostCommandDeps(db, owner.hostAccountId), analyzeAgainCommand, {
      input: {},
      resourceId: owner.hostAccountId,
      retryKey: randomUUID(),
    });
    if (!again.ok) throw new Error("Analyze again failed");
    const job = (await analysisJobs(db, owner.hostAccountId)).find((entry) => entry.payload.analysisId === again.result.analysisId)!;
    await runJob(db, job.id, createCalendarAnalysisHandler(() => ({ classify: standInNoteClassifier, config: fakeGoogleConfig(google), tokenKeys: [key] })));
    return { ...owner, analysisId: again.result.analysisId };
  }

  const confirm = (hostAccountId: string, input: unknown) =>
    runCommand(hostCommandDeps(db, hostAccountId), confirmNoteReviewCommand, { input, resourceId: hostAccountId, retryKey: randomUUID() });

  it("lists the scan's candidates with recommendations and turns 확인 into decisions", async () => {
    const owner = await scanned();
    const review = await readNoteReview(db, owner.hostAccountId);

    expect(review.state).toBe("ready");
    expect(review.items.map((item) => [item.title, item.verdict, item.repeats, item.writable])).toEqual([
      ["분리수거", "note", true, true],
      ["엄마 생일", "note", false, true],
      ["헬스", "event", false, true],
      ["아빠 생일", "note", true, false],
    ]);

    const choices = review.items.map((item) => ({ decision: item.verdict === "note" ? "free" : "keep_busy", key: item.key }));
    const outcome = await confirm(owner.hostAccountId, { analysisId: review.analysisId, choices });
    expect(outcome.ok).toBe(true);

    const decisions = await db<{ event_id: string; scope: string; decision: string; writeback_state: string | null; fingerprint: string }[]>`
      select event_id, scope, decision, writeback_state, fingerprint from app.calendar_note_decisions
      where host_account_id = ${owner.hostAccountId} order by event_id
    `;
    expect(decisions).toEqual([
      { decision: "free", event_id: "dad", fingerprint: "2026-10-01T00:00:00.000Z", scope: "series", writeback_state: "not_writable" },
      { decision: "keep_busy", event_id: "gym", fingerprint: "2026-10-01T00:00:00.000Z", scope: "occurrence", writeback_state: null },
      { decision: "free", event_id: "mom-birthday", fingerprint: "2026-10-01T00:00:00.000Z", scope: "occurrence", writeback_state: "pending" },
      // The latest updated time of the series' listed occurrences.
      { decision: "free", event_id: "recycling", fingerprint: "2026-10-05T00:00:00.000Z", scope: "series", writeback_state: "pending" },
    ]);

    // The answers stay in the review, so the host can go back and change one.
    const after = await readNoteReview(db, owner.hostAccountId);
    expect(after.items.map((item) => [item.title, item.decision])).toEqual([["분리수거", "free"], ["엄마 생일", "free"], ["헬스", "keep_busy"], ["아빠 생일", "free"]]);
    expect(after.decisions.map((decision) => decision.title).sort()).toEqual(["분리수거", "아빠 생일", "엄마 생일", "헬스"]);

    // Confirming again with nothing changed records nothing new.
    const unchanged = after.items.map((item) => ({ decision: item.decision, key: item.key }));
    expect((await confirm(owner.hostAccountId, { analysisId: after.analysisId, choices: unchanged })).ok).toBe(true);
    const [{ revisions }] = await db<{ revisions: number }[]>`
      select sum(revision)::int as revisions from app.calendar_note_decisions where host_account_id = ${owner.hostAccountId}
    `;
    expect(revisions).toBe(4);

    // Going back and unchecking 엄마 생일 keeps it busy again, through Google.
    const birthday = after.items.find((item) => item.title === "엄마 생일")!;
    expect((await confirm(owner.hostAccountId, { analysisId: after.analysisId, choices: [{ decision: "keep_busy", key: birthday.key }] })).ok).toBe(true);
    const [changed] = await db<{ decision: string; writeback_state: string | null; revision: number }[]>`
      select decision, writeback_state, revision from app.calendar_note_decisions
      where host_account_id = ${owner.hostAccountId} and event_id = 'mom-birthday'
    `;
    expect(changed).toEqual({ decision: "keep_busy", revision: 2, writeback_state: "pending" });
  });

  it("frees the one occurrence of a series the host chose", async () => {
    const owner = await scanned();
    const review = await readNoteReview(db, owner.hostAccountId);
    const recycling = review.items.find((item) => item.title === "분리수거")!;
    expect(recycling.occurrences.map((occurrence) => occurrence.id)).toEqual(["recycling_1", "recycling_2", "recycling_3"]);

    const chosen = { decision: "free", key: recycling.key, occurrence: "recycling_2", scope: "occurrence" };
    expect((await confirm(owner.hostAccountId, { analysisId: review.analysisId, choices: [chosen] })).ok).toBe(true);
    const [decision] = await db<{ event_id: string; scope: string; fingerprint: string }[]>`
      select event_id, scope, fingerprint from app.calendar_note_decisions where host_account_id = ${owner.hostAccountId}
    `;
    // That occurrence's own updated time.
    expect(decision).toEqual({ event_id: "recycling_2", fingerprint: "2026-09-20T00:00:00.000Z", scope: "occurrence" });

    // An occurrence the review did not list is refused.
    const again = await readNoteReview(db, owner.hostAccountId);
    const series = again.items.find((item) => item.title === "분리수거")!;
    const invented = await confirm(owner.hostAccountId, {
      analysisId: again.analysisId,
      choices: [{ decision: "free", key: series.key, occurrence: "gym", scope: "occurrence" }],
    });
    expect(invented.ok || invented.error.category).toBe("stale_revision");
  });

  it("draws the week's other busy entries for context, not the candidates, declined or free ones", async () => {
    const owner = await scanned();
    const inputs = await readNoteReview(db, owner.hostAccountId);
    const { review, sources } = buildNoteReview({
      analysis: await readLatestAnalysis(db, owner.hostAccountId),
      calendars: (await db<{ conflict_calendars: CalendarRef[] }[]>`
        select conflict_calendars from app.calendar_roles where host_account_id = ${owner.hostAccountId}
      `)[0]!.conflict_calendars,
      decisions: [],
      now: new Date(),
    });
    expect(review.items).toHaveLength(inputs.items.length);
    const extra = [
      { attendees: [{ email: owner.email, responseStatus: "accepted", self: true }, { email: "guest@example.test", responseStatus: "accepted" }], end: { dateTime: at(2, 3) }, id: "meeting", start: { dateTime: at(2, 2) }, status: "confirmed", summary: "팀 회의", updated: "2026-10-01T00:00:00.000Z" },
      { end: { dateTime: at(2, 5) }, id: "free-time", start: { dateTime: at(2, 4) }, status: "confirmed", summary: "Free", transparency: "transparent", updated: "2026-10-01T00:00:00.000Z" },
      { attendees: [{ email: owner.email, responseStatus: "declined", self: true }, { email: "guest@example.test", responseStatus: "accepted" }], end: { dateTime: at(2, 7) }, id: "declined", start: { dateTime: at(2, 6) }, status: "confirmed", summary: "Declined", updated: "2026-10-01T00:00:00.000Z" },
    ];
    const base = fixture(owner.email);
    google.setFixture(owner.refreshToken!, { ...base, events: { ...base.events, [owner.email]: [...base.events[owner.email]!, ...extra] } });

    const analysis = (await readLatestAnalysis(db, owner.hostAccountId))!;
    const titles = async (requested: string | null) => {
      const week = await readNoteWeek(calendarDeps(), owner.hostAccountId, { analysis, calendars: [{ accessRole: "owner", id: owner.email, summary: owner.email }, { accessRole: "reader", id: BIRTHDAYS, summary: "Birthdays" }], now: new Date(), requested, sources });
      expect(week.contextUnavailable).toBe(false);
      return { titles: week.events.map((event) => event.title), week };
    };
    const first = await titles(null);
    const second = first.week.next ? await titles(first.week.next) : { titles: [] as string[] };
    const all = [...first.titles, ...second.titles];

    expect(all).toContain("팀 회의");
    expect(all).not.toContain("Free");
    expect(all).not.toContain("Declined");
    // Candidates are drawn from the review, never twice.
    expect(all).not.toContain("엄마 생일");
    expect(all).not.toContain("분리수거");
    expect(JSON.stringify(first.week)).not.toContain("guest@example.test");
  });

  it("refuses a review of an older scan or an item it did not show, and records nothing", async () => {
    const owner = await scanned();
    const review = await readNoteReview(db, owner.hostAccountId);
    const key = review.items[0]!.key;

    const old = await confirm(owner.hostAccountId, { analysisId: randomUUID(), choices: [{ decision: "free", key }] });
    const invented = await confirm(owner.hostAccountId, {
      analysisId: review.analysisId,
      choices: [{ decision: "free", key: `event\u0000${owner.email}\u0000someone-elses-event` }],
    });

    expect(old.ok || old.error.category).toBe("stale_revision");
    expect(invented.ok || invented.error.category).toBe("stale_revision");
    const [{ count }] = await db<{ count: number }[]>`
      select count(*)::int as count from app.calendar_note_decisions where host_account_id = ${owner.hostAccountId}
    `;
    expect(count).toBe(0);
  });
});
