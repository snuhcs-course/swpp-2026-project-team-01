import { randomUUID } from "node:crypto";
import { GOOGLE_CALENDAR_SCOPES } from "../../../lib/contracts/google-scopes";
import type { Database } from "../../../lib/server/database";
import { cloudflareEmailConfigFromEnvironment } from "../../../lib/server/cloudflare-email";
import { createEmailDeliveryHandler, EMAIL_DELIVERY_JOB } from "../../../lib/server/email-delivery";
import { createEvaluationHandler, EVALUATION_JOB } from "../../../lib/server/evaluation";
import { recordGoogleGrant } from "../../../lib/server/provider-grants";
import { parseTokenKey } from "../../../lib/server/token-encryption";
import { runJob } from "../../integration/support/calendar-host";
import { makeHostReady, newHostAccount, uniqueHandle } from "../../integration/support/ready-host";
import { settingsFor } from "../../integration/support/scheduling";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./token-key";

// Helpers for the requester journey. The host is made ready in SQL with
// confirmed settings and a Calendar grant sealed with the run's key, whose
// refresh token reads a fixture posted to the fake Google: a primary calendar
// that can create Google Meet and has no events. The job worker runs only in
// production, so the test runs its request's evaluation and email jobs itself,
// through the real handlers against the fake Google, Routes and Cloudflare that
// Playwright starts.

const FAKE_GOOGLE_ORIGIN = `http://127.0.0.1:${process.env.FAKE_GOOGLE_PORT ?? "3103"}`;
const FAKE_ROUTES_ORIGIN = `http://127.0.0.1:${process.env.FAKE_ROUTES_PORT ?? "3105"}`;
export const FAKE_CLOUDFLARE_ORIGIN = `http://127.0.0.1:${process.env.FAKE_CLOUDFLARE_PORT ?? "3104"}`;
const tokenKey = parseTokenKey(E2E_TOKEN_ENCRYPTION_KEY);

const calendarConfig = {
  apiBaseUrl: `${FAKE_GOOGLE_ORIGIN}/calendar/v3`,
  clientId: "e2e-google-client",
  clientSecret: "e2e-google-secret",
  timeoutMs: 10_000,
  tokenUrl: `${FAKE_GOOGLE_ORIGIN}/token`,
};

export async function readyRequestHost(db: Database, displayName = "Ada Lovelace") {
  const hostAccountId = await newHostAccount(db);
  const handle = uniqueHandle("ada");
  await makeHostReady(db, hostAccountId, { displayName, handle });

  const calendarId = `host-${randomUUID()}@example.test`;
  const refreshToken = `1//e2e-requester-${randomUUID()}`;
  const fixture = await fetch(`${FAKE_GOOGLE_ORIGIN}/__fixture/${encodeURIComponent(refreshToken)}`, {
    body: JSON.stringify({
      calendars: [
        { accessRole: "owner", conferenceSolutionTypes: ["hangoutsMeet"], id: calendarId, primary: true, summary: "Work", timeZone: "Asia/Seoul" },
      ],
      events: { [calendarId]: [] },
    }),
    method: "POST",
  });
  if (!fixture.ok) throw new Error(`Posting the fake Google fixture failed with ${fixture.status}.`);

  await recordGoogleGrant(db, tokenKey, { grantedScopes: [...GOOGLE_CALENDAR_SCOPES], hostAccountId, refreshToken });
  await db`
    update app.host_settings
    set settings = ${db.json(settingsFor(calendarId, { displayName, handle }) as never)}
    where host_account_id = ${hostAccountId}
  `;

  return { displayName, handle, hostAccountId };
}

// Runs the request's pending jobs of one kind through the real handler; returns
// how many ran.
async function runPending(db: Database, requestId: string, kind: string, handler: Parameters<typeof runJob>[2]) {
  const pending =
    kind === EVALUATION_JOB
      ? await db<{ id: string }[]>`
          select j.id from app.jobs j join app.evaluations e on e.id = (j.payload ->> 'evaluationId')::uuid
          where j.kind = ${kind} and j.state = 'pending' and e.request_id = ${requestId}
        `
      : await db<{ id: string }[]>`
          select j.id from app.jobs j join app.email_deliveries d on d.id = (j.payload ->> 'deliveryId')::uuid
          where j.kind = ${kind} and j.state = 'pending' and d.request_id = ${requestId}
        `;

  for (const job of pending) await runJob(db, job.id, handler);
  return pending.length;
}

export function runEvaluations(db: Database, requestId: string) {
  return runPending(
    db,
    requestId,
    EVALUATION_JOB,
    createEvaluationHandler(() => ({
      calendar: calendarConfig,
      db,
      // Ranking falls back to the deterministic order without a model.
      model: null,
      requesterCalendar: calendarConfig,
      routes: { apiKey: "fake-routes-key", baseUrl: FAKE_ROUTES_ORIGIN, timeoutMs: 5_000 },
      tokenKeys: [tokenKey],
    })),
  );
}

export function runEmails(db: Database, requestId: string) {
  return runPending(
    db,
    requestId,
    EMAIL_DELIVERY_JOB,
    createEmailDeliveryHandler(() => ({
      config: cloudflareEmailConfigFromEnvironment({
        CLOUDFLARE_ACCOUNT_ID: "e2e-account",
        CLOUDFLARE_EMAIL_API_TOKEN: "e2e-email-token",
        CLOUDFLARE_EMAIL_API_URL: FAKE_CLOUDFLARE_ORIGIN,
        CLOUDFLARE_EMAIL_FROM: "no-reply@e2e.example.test",
      }),
      db,
      env: { CLOUDFLARE_EMAIL_API_URL: FAKE_CLOUDFLARE_ORIGIN },
      tokenKeys: [tokenKey],
    })),
  );
}

export async function sentTo(recipient: string) {
  const response = await fetch(`${FAKE_CLOUDFLARE_ORIGIN}/__messages?to=${encodeURIComponent(recipient)}`);
  return (await response.json()) as { subject: string; text: string }[];
}
