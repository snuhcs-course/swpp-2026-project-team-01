import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analysisForModel,
  analyzeAgainCommand,
  createCalendarAnalysisHandler,
  readLatestAnalysis,
  setUpManuallyCommand,
  suggestFromEvidence,
} from "../../lib/server/analysis";
import { saveCalendarRolesCommand } from "../../lib/server/calendar-roles";
import { type CommandDefinition, runCommand } from "../../lib/server/commands";
import { openHostCalendar } from "../../lib/server/google-calendar";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { analysisJobs, createCalendarHost, fakeGoogleConfig, hostCommandDeps, runJob } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { defaultGoogleFixture, type FakeGoogle, type FakeGoogleFixture, startFakeGoogle } from "./support/fake-google";

const db = testDatabase();
const key = parseTokenKey(randomBytes(32).toString("base64"));
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

function calendarDeps() {
  return { config: fakeGoogleConfig(google), db, tokenKeys: [key] };
}

const handler = () => createCalendarAnalysisHandler(() => ({ config: fakeGoogleConfig(google), tokenKeys: [key] }));
const TEAM = "team@group.calendar.google.com";

// A host with the default fixture whose roles (primary and Team) are saved, which
// publishes the first scan.
async function hostWithSavedRoles(fixture?: (email: string) => FakeGoogleFixture) {
  const host = await createCalendarHost(db, key);
  google.setFixture(host.refreshToken!, fixture?.(host.email) ?? defaultGoogleFixture(new Date(), host.email));
  const live = (await (await openHostCalendar(calendarDeps(), host.hostAccountId)).listCalendars()).calendars;
  const saved = await runCommand(hostCommandDeps(db, host.hostAccountId), saveCalendarRolesCommand(live), {
    expectedRevision: null,
    input: { bookingCalendarId: host.email, conflictCalendarIds: [host.email, TEAM] },
    resourceId: host.hostAccountId,
    retryKey: randomUUID(),
  });

  if (!saved.ok) throw new Error(`Saving roles failed: ${saved.error.category}`);
  const [job] = await analysisJobs(db, host.hostAccountId);
  return { ...host, analysisId: saved.result.analysisId, jobId: job!.id };
}

async function jobState(jobId: string) {
  const [row] = await db<{ state: string }[]>`select state from app.jobs where id = ${jobId}`;
  return row!.state;
}

function runCommandFor<Result>(
  hostAccountId: string,
  command: CommandDefinition<Record<string, never>, Result>,
  retryKey: string = randomUUID(),
) {
  return runCommand(hostCommandDeps(db, hostAccountId), command, {
    input: {},
    resourceId: hostAccountId,
    retryKey,
  });
}

describe("calendar analysis job", () => {
  it("stores the evidence dimensions of the saved conflict calendars", async () => {
    const host = await hostWithSavedRoles();

    expect(await runJob(db, host.jobId, handler())).toBe("completed");

    const card = await readLatestAnalysis(db, host.hostAccountId);
    expect(card).toMatchObject({
      calendars: [
        { id: host.email, ok: true },
        { id: TEAM, ok: true, summary: "Team" },
      ],
      failureCategory: null,
      id: host.analysisId,
      state: "completed",
    });

    const evidence = card!.evidence!;
    expect(evidence.timezone).toBe("Asia/Seoul");
    expect(evidence.preferredTimes.sampleSize).toBe(12);
    expect(evidence.preferredTimes.cells).toEqual([
      { count: 4, hour: 10, weekday: "tuesday" },
      { count: 4, hour: 14, weekday: "wednesday" },
      { count: 4, hour: 16, weekday: "thursday" },
    ]);
    expect(evidence.meetingLoad).toMatchObject({ max: 3, min: 3, sampleSize: 12 });
    expect(evidence.meetingLoad.weeks).toHaveLength(4);
    expect(evidence.meetingLoad.weeks.every((week) => week.internal === 1 && week.external === 2)).toBe(true);
    expect(evidence.places).toEqual({
      area: { count: 3, name: "Seongsu" },
      sampleSize: 3,
      venue: { count: 3, name: "Blue Bottle Coffee" },
    });
    expect(evidence.noteLike.entries.map((entry) => entry.title).sort()).toEqual(["Focus time", "Write quarterly report"]);
    expect(evidence.durations).toEqual({ medianMinutes: 30, sampleSize: 12 });
    expect(JSON.stringify(evidence)).not.toContain("colleague@example.test");

    const suggestions = suggestFromEvidence(evidence, "Asia/Seoul");
    expect(suggestions.weeklyWindows).toMatchObject({ sampleSize: 12, source: "inferred" });
    expect(suggestions.weeklyLimit).toMatchObject({ source: "inferred", value: 3 });

    const model = analysisForModel(card!);
    expect(model.evidence!.noteLikeCount).toBe(2);
    expect(JSON.stringify(model)).not.toContain("Focus time");
  });

  it("counts in the draft's timezone when the host already chose one", async () => {
    const host = await hostWithSavedRoles();
    await db`
      update app.setup_drafts
      set fields = ${db.json({ timezone: { accepted: true, source: "stated", value: "UTC" } })}
      where host_account_id = ${host.hostAccountId}
    `;

    await runJob(db, host.jobId, handler());

    const evidence = (await readLatestAnalysis(db, host.hostAccountId))!.evidence!;
    expect(evidence.timezone).toBe("UTC");
    expect(evidence.preferredTimes.cells[0]).toEqual({ count: 4, hour: 1, weekday: "tuesday" });
  });

  it("discloses a partial failure, stores no evidence and commits the failure", async () => {
    const host = await hostWithSavedRoles((email) => ({ ...defaultGoogleFixture(new Date(), email), failingCalendars: [TEAM] }));

    expect(await runJob(db, host.jobId, handler())).toBe("completed");

    expect(await jobState(host.jobId)).toBe("completed");
    expect(await readLatestAnalysis(db, host.hostAccountId)).toMatchObject({
      calendars: [
        { id: host.email, ok: true },
        { id: TEAM, ok: false, summary: "Team" },
      ],
      evidence: null,
      failureCategory: "calendar_unavailable",
      state: "failed",
    });
  });

  it("records a revoked grant as a failed scan and marks the grant invalid", async () => {
    const host = await hostWithSavedRoles();
    google.setFixture(host.refreshToken!, { ...defaultGoogleFixture(new Date(), host.email), revoked: true });

    expect(await runJob(db, host.jobId, handler())).toBe("completed");

    expect(await readLatestAnalysis(db, host.hostAccountId)).toMatchObject({
      calendars: [
        { id: host.email, ok: false },
        { id: TEAM, ok: false },
      ],
      evidence: null,
      failureCategory: "calendar_access_revoked",
      state: "failed",
    });
    const [grant] = await db`select invalidated_at is not null as invalid from app.provider_grants where host_account_id = ${host.hostAccountId}`;
    expect(grant).toEqual({ invalid: true });
  });

  it("records missing client configuration as a failed scan instead of retrying forever", async () => {
    const host = await hostWithSavedRoles();
    const unconfigured = createCalendarAnalysisHandler(() => ({
      config: fakeGoogleConfig(google, { clientId: "", clientSecret: "" }),
      tokenKeys: [key],
    }));

    expect(await runJob(db, host.jobId, unconfigured)).toBe("completed");
    expect(await readLatestAnalysis(db, host.hostAccountId)).toMatchObject({
      failureCategory: "calendar_unavailable",
      state: "failed",
    });
  });

  it("does not scan again on reload or redelivery", async () => {
    const host = await hostWithSavedRoles();
    await runJob(db, host.jobId, handler());
    const eventReads = () => google.requests.filter((request) => request.path.endsWith("/events")).length;
    const reads = eventReads();

    // Reloading the workspace reads the analysis twice.
    const first = await readLatestAnalysis(db, host.hostAccountId);
    const second = await readLatestAnalysis(db, host.hostAccountId);

    expect(second).toEqual(first);
    expect(await analysisJobs(db, host.hostAccountId)).toHaveLength(1);

    // A redelivered job finds the scan no longer pending.
    const outcome = await db.begin((tx) =>
      handler()(tx, { attempts: 2, fence: 99, id: host.jobId, kind: "calendar_analysis", maxAttempts: 5, payload: { analysisId: host.analysisId } }),
    );
    expect(outcome).toEqual({ skipped: true });
    expect(eventReads()).toBe(reads);
  });
});

describe("Analyze again and Set up manually", () => {
  it("publishes one fresh scan per request and replays an exact retry", async () => {
    const host = await hostWithSavedRoles();
    await runJob(db, host.jobId, handler());

    const first = await runCommandFor(host.hostAccountId, analyzeAgainCommand, "analyze-again-1");
    const retry = await runCommandFor(host.hostAccountId, analyzeAgainCommand, "analyze-again-1");

    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(retry).toMatchObject({ ok: true, replayed: true });
    expect(retry.ok && retry.result).toEqual(first.ok && first.result);
    expect(await analysisJobs(db, host.hostAccountId)).toHaveLength(2);
    expect(await readLatestAnalysis(db, host.hostAccountId)).toMatchObject({
      id: first.ok && first.result.analysisId,
      state: "pending",
    });

    const another = await runCommandFor(host.hostAccountId, analyzeAgainCommand);
    expect(another.ok && another.result.analysisId).not.toBe(first.ok && first.result.analysisId);
    expect(await analysisJobs(db, host.hostAccountId)).toHaveLength(3);
  });

  it("requires saved roles", async () => {
    const host = await createCalendarHost(db, key);

    expect(await runCommandFor(host.hostAccountId, analyzeAgainCommand)).toMatchObject({
      error: { category: "invalid_input" },
      ok: false,
    });
  });

  it("records the manual choice, which Analyze again clears", async () => {
    const host = await hostWithSavedRoles();
    const skipped = async () => {
      const [row] = await db<{ analysis_skipped: boolean }[]>`
        select analysis_skipped from app.setup_drafts where host_account_id = ${host.hostAccountId}
      `;
      return row!.analysis_skipped;
    };

    expect(await runCommandFor(host.hostAccountId, setUpManuallyCommand)).toMatchObject({
      ok: true,
      result: { analysisSkipped: true },
    });
    expect(await skipped()).toBe(true);

    await runCommandFor(host.hostAccountId, analyzeAgainCommand);
    expect(await skipped()).toBe(false);
  });

  it("refuses a suspended host", async () => {
    const host = await hostWithSavedRoles();
    await db`update app.host_accounts set status = 'suspended' where id = ${host.hostAccountId}`;

    expect(await runCommandFor(host.hostAccountId, analyzeAgainCommand)).toMatchObject({ error: { category: "forbidden" } });
    expect(await runCommandFor(host.hostAccountId, setUpManuallyCommand)).toMatchObject({ error: { category: "forbidden" } });
    expect(await analysisJobs(db, host.hostAccountId)).toHaveLength(1);
  });
});
