import { randomUUID } from "node:crypto";
import { GOOGLE_CALENDAR_SCOPES } from "../../../lib/contracts/google-scopes";
import { createCalendarAnalysisHandler } from "../../../lib/server/analysis";
import type { Database } from "../../../lib/server/database";
import { recordGoogleGrant } from "../../../lib/server/provider-grants";
import { parseTokenKey } from "../../../lib/server/token-encryption";
import { analysisJobs, runJob } from "../../integration/support/calendar-host";
import { defaultGoogleFixture } from "../../integration/support/fake-google";
import { runCommand } from "../../../lib/server/commands";
import { updateDraftCommand } from "../../../lib/server/setup-commands";
import { draftRevision, hostCommandDeps, prepareReviewableHost } from "../../integration/support/setup-host";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./token-key";

// Setup helpers for the browser tests. The web server Playwright starts seals
// refresh tokens with E2E_TOKEN_ENCRYPTION_KEY, so a grant written here is one
// the app can open; every refresh token reads the fake Google's default fixture.

const FAKE_GOOGLE_ORIGIN = `http://127.0.0.1:${process.env.FAKE_GOOGLE_PORT ?? "3103"}`;
const tokenKey = parseTokenKey(E2E_TOKEN_ENCRYPTION_KEY);

// The default fixture's calendars: the primary calendar's ID is its address.
export const PRIMARY_CALENDAR_ID = "host@example.test";

// Gives a signed-in host a grant with the three Calendar scopes and a sealed
// refresh token, as the callback records after Calendar consent.
export async function grantCalendar(db: Database, hostAccountId: string) {
  await recordGoogleGrant(db, tokenKey, {
    grantedScopes: [...GOOGLE_CALENDAR_SCOPES],
    hostAccountId,
    refreshToken: `1//e2e-${randomUUID()}`,
  });
}

// The job worker runs only in production, so the test runs the host's pending
// scans itself, through the real handler against the fake Google.
export async function runPendingAnalyses(db: Database, hostAccountId: string) {
  const handler = createCalendarAnalysisHandler(() => ({
    config: {
      apiBaseUrl: `${FAKE_GOOGLE_ORIGIN}/calendar/v3`,
      clientId: "e2e-google-client",
      clientSecret: "e2e-google-secret",
      timeoutMs: 10_000,
      tokenUrl: `${FAKE_GOOGLE_ORIGIN}/token`,
    },
    tokenKeys: [tokenKey],
  }));
  const pending = (await analysisJobs(db, hostAccountId)).filter((job) => job.state === "pending");

  for (const job of pending) await runJob(db, job.id, handler);
  return pending.length;
}

// A granted host whose roles are saved, scan skipped and mode answered Online,
// which leaves the review ready to confirm.
export async function reviewableHost(db: Database, hostAccountId: string) {
  await grantCalendar(db, hostAccountId);
  const calendars = defaultGoogleFixture().calendars;
  await prepareReviewableHost(db, {
    calendars,
    hostAccountId,
    primaryId: PRIMARY_CALENDAR_ID,
  } as unknown as Parameters<typeof prepareReviewableHost>[1]);
}

// Accepts the remaining suggestion steps as the host's own choices, so the
// stepper opens on the review (or, without `handle`, on the identity step).
export async function acceptSuggestions(db: Database, hostAccountId: string, identity?: { handle: string; displayName: string }) {
  const values: [string, unknown][] = [
    ["timezone", "Asia/Seoul"],
    [
      "weeklyWindows",
      (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((weekday) => ({ end: "17:00", start: "10:00", weekday })),
    ],
    ["weeklyLimit", null],
    ["durationMinutes", 30],
    ["bufferBeforeMinutes", 10],
    ["bufferAfterMinutes", 10],
  ];
  if (identity) values.push(["displayName", identity.displayName], ["handle", identity.handle]);

  for (const [field, value] of values) {
    const result = await runCommand(hostCommandDeps(db, hostAccountId), updateDraftCommand, {
      expectedRevision: await draftRevision(db, hostAccountId),
      input: { action: "choose_own", field, value },
      resourceId: hostAccountId,
      retryKey: randomUUID(),
    });
    if (!result.ok) throw new Error(`Accepting ${field} failed: ${JSON.stringify(result)}`);
  }
}
