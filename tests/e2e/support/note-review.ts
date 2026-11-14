import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { GOOGLE_CALENDAR_SCOPES } from "../../../lib/contracts/google-scopes";
import { limitNoteClassifier } from "../../../lib/server/model-limits";
import { createCalendarAnalysisHandler } from "../../../lib/server/analysis";
import { saveCalendarRolesCommand } from "../../../lib/server/calendar-roles";
import { runCommand } from "../../../lib/server/commands";
import type { Database } from "../../../lib/server/database";
import { type GoogleCalendarConfig, openHostCalendar } from "../../../lib/server/google-calendar";
import { createNoteWritebackHandler, NOTE_WRITEBACK_JOB } from "../../../lib/server/note-decisions";
import { standInNoteClassifier } from "../../../lib/server/note-classifier-stand-in";
import { recordGoogleGrant } from "../../../lib/server/provider-grants";
import { parseTokenKey } from "../../../lib/server/token-encryption";
import { analysisJobs, hostCommandDeps, runJob } from "../../integration/support/calendar-host";
import type { FakeEvent, FakeGoogleFixture } from "../../integration/support/fake-google";
import { signedInHost } from "./session";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./token-key";

// A host whose calendars hold typical note candidates, scanned with the
// classifier's local stand-in, for the note review's browser test and preview.
// The fake Google (port 3103) serves this host's own fixture; the scan and the
// writebacks run from the test process, since the job worker is production-only.

const FAKE_GOOGLE_ORIGIN = `http://127.0.0.1:${process.env.FAKE_GOOGLE_PORT ?? "3103"}`;
const tokenKey = parseTokenKey(E2E_TOKEN_ENCRYPTION_KEY);
const BIRTHDAYS = "birthdays@group.v.calendar.google.com";

const config: GoogleCalendarConfig = {
  apiBaseUrl: `${FAKE_GOOGLE_ORIGIN}/calendar/v3`,
  clientId: "e2e-google-client",
  clientSecret: "e2e-google-secret",
  timeoutMs: 10_000,
  tokenUrl: `${FAKE_GOOGLE_ORIGIN}/token`,
};

const DAY = 86_400_000;
// The Monday that starts this week in Seoul, as a date.
function thisMonday() {
  const seoulToday = new Date(Date.now() + 9 * 3_600_000);
  const weekday = (seoulToday.getUTCDay() + 6) % 7;
  return Date.UTC(seoulToday.getUTCFullYear(), seoulToday.getUTCMonth(), seoulToday.getUTCDate() - weekday);
}
// A date counted from this week's Monday, so every entry lands on a fixed
// weekday of next week whatever day the test runs.
const date = (offsetDays: number) => new Date(thisMonday() + offsetDays * DAY).toISOString().slice(0, 10);
// A local Seoul hour as UTC (Seoul is UTC+9).
const seoul = (offsetDays: number, hour: number) => new Date(Date.parse(`${date(offsetDays)}T00:00:00Z`) + (hour - 9) * 3_600_000).toISOString();

function timed(id: string, summary: string, offsetDays: number, hour: number, extra: Partial<FakeEvent> = {}): FakeEvent {
  return {
    end: { dateTime: seoul(offsetDays, hour + 1) },
    id,
    start: { dateTime: seoul(offsetDays, hour) },
    status: "confirmed",
    summary,
    updated: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

function allDay(id: string, summary: string, offsetDays: number, extra: Partial<FakeEvent> = {}): FakeEvent {
  return { end: { date: date(offsetDays + 1) }, id, start: { date: date(offsetDays) }, status: "confirmed", summary, updated: "2026-10-01T00:00:00.000Z", ...extra };
}

// Next week (Monday is day 7): six note candidates among four real meetings,
// so the host judges each one beside the rest of the week; the weekly 분리수거
// goes on into the weeks after.
export const NEXT_WEEK = 7;

export function noteReviewFixture(email: string): FakeGoogleFixture {
  const self = { email, responseStatus: "accepted", self: true };
  const meeting = (id: string, summary: string, day: number, hour: number, guest: string) =>
    timed(id, summary, day, hour, { attendees: [self, { email: guest, responseStatus: "accepted" }] });
  return {
    calendars: [
      { accessRole: "owner", id: email, primary: true, summary: email, timeZone: "Asia/Seoul" },
      { accessRole: "reader", id: BIRTHDAYS, summary: "Birthdays", timeZone: "Asia/Seoul" },
    ],
    events: {
      [email]: [
        // Real meetings: another attendee, so never candidates, drawn in grey.
        meeting("team", "팀 회의", NEXT_WEEK, 10, "colleague@example.test"),
        meeting("lunch", "점심 약속", NEXT_WEEK + 1, 12, "friend@example.test"),
        meeting("one-on-one", "1:1 with 민지", NEXT_WEEK + 2, 15, "minji@example.test"),
        meeting("client", "Client check-in", NEXT_WEEK + 3, 10, "client@client.test"),
        // Note candidates.
        timed("gym", "헬스", NEXT_WEEK + 1, 19, { location: "동네 헬스장" }),
        ...[1, 8, 15].map((offset, index) => timed(`recycling_${index + 1}`, "분리수거", NEXT_WEEK + offset, 21, { recurringEventId: "recycling" })),
        allDay("mom-birthday", "엄마 생일", NEXT_WEEK + 2),
        timed("study", "스터디 준비", NEXT_WEEK + 3, 14),
        allDay("assignment", "과제 마감", NEXT_WEEK + 4),
      ],
      [BIRTHDAYS]: [allDay("dad_2026", "아빠 생일", NEXT_WEEK + 5, { recurringEventId: "dad" })],
    },
  };
}

export async function noteReviewHost(db: Database, context: BrowserContext, baseURL: string, locale: "ko" | "en" = "ko") {
  const host = await signedInHost(db, context, baseURL);
  await context.addCookies([{ domain: new URL(baseURL).hostname, name: "lang", path: "/", value: locale }]);
  const refreshToken = `1//e2e-notes-${randomUUID()}`;
  const response = await fetch(`${FAKE_GOOGLE_ORIGIN}/__fixture/${encodeURIComponent(refreshToken)}`, {
    body: JSON.stringify(noteReviewFixture("host@example.test")),
    method: "POST",
  });
  if (!response.ok) throw new Error(`Setting the Google fixture failed with ${response.status}.`);
  await recordGoogleGrant(db, tokenKey, { grantedScopes: [...GOOGLE_CALENDAR_SCOPES], hostAccountId: host.hostAccountId, refreshToken });

  const live = (await (await openHostCalendar({ config, db, tokenKeys: [tokenKey] }, host.hostAccountId)).listCalendars()).calendars;
  const saved = await runCommand(hostCommandDeps(db, host.hostAccountId), saveCalendarRolesCommand(live), {
    expectedRevision: null,
    input: { bookingCalendarId: "host@example.test", conflictCalendarIds: ["host@example.test", BIRTHDAYS] },
    resourceId: host.hostAccountId,
    retryKey: randomUUID(),
  });
  if (!saved.ok) throw new Error(`Saving roles failed: ${saved.error.category}`);

  // The classifier reserves its usage limit in this test database.
  const handler = createCalendarAnalysisHandler(() => ({
    classify: standInNoteClassifier,
    config,
    limitClassifier: (model, hostAccountId) => limitNoteClassifier(model, hostAccountId, () => db),
    tokenKeys: [tokenKey],
  }));
  for (const job of (await analysisJobs(db, host.hostAccountId)).filter((entry) => entry.state === "pending")) {
    await runJob(db, job.id, handler);
  }
  return host;
}

// Runs the host's pending writebacks against the fake Google.
export async function runPendingWritebacks(db: Database, hostAccountId: string) {
  const handler = createNoteWritebackHandler(() => ({ config, tokenKeys: [tokenKey] }));
  const jobs = await db<{ id: string }[]>`
    select j.id from app.jobs j
    join app.calendar_note_decisions d on d.id::text = j.payload ->> 'decisionId'
    where j.kind = ${NOTE_WRITEBACK_JOB} and j.state = 'pending' and d.host_account_id = ${hostAccountId}
  `;
  for (const job of jobs) await runJob(db, job.id, handler);
  return jobs.length;
}
