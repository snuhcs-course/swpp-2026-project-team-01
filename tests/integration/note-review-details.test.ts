import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOOGLE_CALENDAR_SCOPES } from "../../lib/contracts/google-scopes";
import type { NoteReview } from "../../lib/contracts/note-review";
import { analyzeAgainCommand, createCalendarAnalysisHandler } from "../../lib/server/analysis";
import { saveCalendarRolesCommand } from "../../lib/server/calendar-roles";
import { runCommand } from "../../lib/server/commands";
import { openHostCalendar } from "../../lib/server/google-calendar";
import { standInNoteClassifier } from "../../lib/server/note-classifier-stand-in";
import { createNoteReviewHandler } from "../../lib/server/note-review";
import { recordGoogleGrant } from "../../lib/server/provider-grants";
import type { SetupRouteDependencies } from "../../lib/server/setup-routes";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { localAuthConfig, signInHost } from "./support/auth";
import { analysisJobs, fakeGoogleConfig, hostCommandDeps, runJob } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { type FakeEvent, type FakeGoogle, startFakeGoogle } from "./support/fake-google";

// The note review's entry details (calendar-note-review design 7): the week
// carries each entry's Google description, as plain text, read live with the
// grey entries. It reaches only the signed-in host whose calendar it is, and it
// is stored nowhere and sent to no model.

const db = testDatabase();
const key = parseTokenKey(randomBytes(32).toString("base64"));
const origin = "http://localhost:3000";
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

function timed(id: string, summary: string, extra: Partial<FakeEvent> = {}): FakeEvent {
  return { end: { dateTime: at(4, 11) }, id, start: { dateTime: at(4, 10) }, status: "confirmed", summary, updated: "2026-10-01T00:00:00.000Z", ...extra };
}

// A signed-in host whose calendar holds a note candidate and a meeting, each
// with a description that is HTML, as Google keeps one written in its editor.
async function describedHost(marker: string) {
  const signed = await signInHost(db);
  const [identity] = await db<{ email: string }[]>`select email from app.google_identities where host_account_id = ${signed.hostAccountId}`;
  const email = identity!.email;
  const refreshToken = `1//refresh-${randomUUID()}`;
  await recordGoogleGrant(db, key, { grantedScopes: [...GOOGLE_CALENDAR_SCOPES], hostAccountId: signed.hostAccountId, refreshToken });
  google.setFixture(refreshToken, {
    calendars: [{ accessRole: "owner", id: email, primary: true, summary: email, timeZone: "UTC" }],
    events: {
      [email]: [
        timed("gym", "헬스", { description: `<b>준비물</b>: 운동화<br>${marker}-gym` }),
        timed("meeting", "팀 회의", {
          attendees: [{ email, responseStatus: "accepted", self: true }, { email: "guest@example.test", responseStatus: "accepted" }],
          description: `회의실 <a href="https://example.test">3층</a> &amp; ${marker}-meeting`,
          end: { dateTime: at(4, 13) },
          start: { dateTime: at(4, 12) },
        }),
      ],
    },
  });

  const calendarDeps = { config: fakeGoogleConfig(google), db, tokenKeys: [key] };
  const live = (await (await openHostCalendar(calendarDeps, signed.hostAccountId)).listCalendars()).calendars;
  const saved = await runCommand(hostCommandDeps(db, signed.hostAccountId), saveCalendarRolesCommand(live), {
    expectedRevision: null,
    input: { bookingCalendarId: email, conflictCalendarIds: [email] },
    resourceId: signed.hostAccountId,
    retryKey: randomUUID(),
  });
  if (!saved.ok) throw new Error(`Saving roles failed: ${saved.error.category}`);

  // The scan, with what reaches the classifier recorded.
  const classified: string[] = [];
  const classify: typeof standInNoteClassifier = async (items, ...rest) => {
    classified.push(JSON.stringify(items));
    return standInNoteClassifier(items, ...rest);
  };
  const again = await runCommand(hostCommandDeps(db, signed.hostAccountId), analyzeAgainCommand, {
    input: {},
    resourceId: signed.hostAccountId,
    retryKey: randomUUID(),
  });
  if (!again.ok) throw new Error("Analyze again failed");
  const job = (await analysisJobs(db, signed.hostAccountId)).find((entry) => entry.payload.analysisId === again.result.analysisId)!;
  await runJob(db, job.id, createCalendarAnalysisHandler(() => ({ classify, config: fakeGoogleConfig(google), tokenKeys: [key] })));

  return { ...signed, classified, email };
}

const handler = createNoteReviewHandler(
  (): SetupRouteDependencies => ({ appOrigin: origin, auth: localAuthConfig(), calendar: { config: fakeGoogleConfig(google), db, tokenKeys: [key] }, db }),
);

async function review(cookie: string | null) {
  const response = await handler(new Request(`${origin}/api/notes/review?week=${date(4)}`, { headers: cookie ? { cookie } : {} }));
  return { body: (await response.json()) as NoteReview, status: response.status };
}

// Every text column of the app's tables that holds the marker.
async function storedAnywhere(marker: string) {
  const columns = await db<{ table_schema: string; table_name: string; column_name: string }[]>`
    select c.table_schema, c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema in ('app', 'public', 'private')
      and c.data_type in ('text', 'jsonb', 'json', 'character varying', 'ARRAY')
  `;
  const found: string[] = [];
  for (const column of columns) {
    const [row] = await db.unsafe<{ count: number }[]>(
      `select count(*)::int as count from "${column.table_schema}"."${column.table_name}" where "${column.column_name}"::text like $1`,
      [`%${marker}%`],
    );
    if (row!.count > 0) found.push(`${column.table_schema}.${column.table_name}.${column.column_name}`);
  }
  return found;
}

describe("the note review's entry details", () => {
  it("returns each entry's description as plain text to the signed-in host whose calendar it is", async () => {
    const marker = `desc-${randomUUID()}`;
    const owner = await describedHost(marker);

    expect((await review(null)).status).toBe(401);

    const { body, status } = await review(owner.cookie);
    expect(status).toBe(200);
    const gym = body.items.find((item) => item.title === "헬스")!;
    expect(body.week?.descriptions).toEqual([{ description: `준비물: 운동화\n${marker}-gym`, key: gym.key, occurrence: "gym" }]);
    expect(body.week?.events.find((event) => event.title === "팀 회의")?.description).toBe(`회의실 3층 & ${marker}-meeting`);
    // Only text leaves the server: no markup, no attendee.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/<b>|<br>|<a /);
    expect(raw).not.toContain("guest@example.test");

    // Another signed-in host gets only their own calendar.
    const other = await describedHost(`other-${randomUUID()}`);
    const theirs = JSON.stringify((await review(other.cookie)).body);
    expect(theirs).not.toContain(marker);
  });

  it("stores no description and sends none to the classifier", async () => {
    const marker = `desc-${randomUUID()}`;
    const owner = await describedHost(marker);
    expect(JSON.stringify((await review(owner.cookie)).body)).toContain(marker);

    // The scan ran before the review was read, so the classifier and the
    // scan's evidence never had a description to see.
    expect(owner.classified.length).toBeGreaterThan(0);
    expect(owner.classified.join("")).not.toContain(marker);
    expect(owner.classified.join("")).not.toContain("준비물");
    expect(await storedAnywhere(marker)).toEqual([]);
  });
});
