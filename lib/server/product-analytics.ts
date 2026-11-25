import { createHash } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { PostHog } from "posthog-node";
import type { Queryable } from "./database";
import { deploymentEnvironment } from "./deployment";

// Server-side product analytics (web-analytics design D7). The command pipeline,
// the job worker, the channel receivers and the agent's hook report what
// happened to PostHog: an operation's name and outcome, a job's kind and result,
// a message's channel and content type, a tool's name. Never a message body, a
// phone number, an email address, a name, a calendar, a booking link or a
// resource ID. A host is identified by their host account ID, the same ID the
// browser identifies them by; anyone else is a pseudonymous hash and gets no
// person profile. Only Vercel production with POSTHOG_PROJECT_KEY sends
// anything, and a failure to send never changes the caller's result.

type Environment = Readonly<Record<string, string | undefined>>;

const PROJECT_KEY = /^phc_[A-Za-z0-9]+$/;

export type ServerAnalyticsConfig = { readonly key: string; readonly host: string };

// The project key and events host, or null when analytics stays off. Unlike the
// web app's gate, this one reads production as lib/server/deployment.ts does.
export function serverAnalyticsConfig(env: Environment = process.env): ServerAnalyticsConfig | null {
  const key = env.POSTHOG_PROJECT_KEY?.trim();
  const region = env.POSTHOG_REGION?.trim() || "us";

  if (!key || !PROJECT_KEY.test(key) || (region !== "us" && region !== "eu")) return null;
  if (deploymentEnvironment(env) !== "production") return null;

  return { host: `https://${region}.i.posthog.com`, key };
}

// Who an event is about: a host by their account ID, or an anonymous subject by
// a hash of its own ID (a request, an intake, a guest), with no person profile.
export type AnalyticsSubject =
  | { readonly kind: "host"; readonly hostAccountId: string }
  | { readonly kind: "anonymous"; readonly scope: string; readonly id?: string };

export type ServerAnalyticsEvent = {
  readonly event: string;
  readonly subject: AnalyticsSubject;
  readonly properties?: Readonly<Record<string, string | number | boolean | null>>;
};

export type AnalyticsSink = {
  capture(message: { distinctId: string; event: string; properties: Record<string, unknown> }): void;
  flush(): Promise<void>;
};

// A pseudonym that groups one subject's events without revealing its ID.
export function anonymousAnalyticsId(scope: string, id: string) {
  return `${scope}:${createHash("sha256").update(`findmeatime-analytics:${scope}:${id}`).digest("hex").slice(0, 20)}`;
}

export function analyticsMessage(event: ServerAnalyticsEvent, env: Environment = process.env) {
  const host = event.subject.kind === "host";
  const subject = event.subject;
  return {
    distinctId: subject.kind === "host" ? subject.hostAccountId : subject.id ? anonymousAnalyticsId(subject.scope, subject.id) : `${subject.scope}:anonymous`,
    event: event.event,
    properties: {
      ...event.properties,
      $process_person_profile: host,
      deployment: env.VERCEL_ENV?.trim() ?? null,
      source: "server",
    },
  };
}

// One client per project and host, created on first use.
const sinks = new Map<string, AnalyticsSink>();
let testSink: AnalyticsSink | null | undefined;

function analyticsSink(env: Environment): AnalyticsSink | null {
  if (testSink !== undefined) return testSink;
  // The gate is read on every call, so the caller's environment always decides.
  const config = serverAnalyticsConfig(env);
  if (!config) return null;
  const id = `${config.host} ${config.key}`;
  let sink = sinks.get(id);
  if (!sink) {
    // Serverless instances may freeze between requests: send each event at once,
    // and keep the function alive until it is sent.
    sink = new PostHog(config.key, { flushAt: 1, flushInterval: 0, host: config.host, requestTimeout: 3_000 });
    sinks.set(id, sink);
  }
  return sink;
}

// Tests replace the PostHog client; null turns analytics off, undefined
// returns to the environment's gate.
export function setAnalyticsSinkForTests(replacement: AnalyticsSink | null | undefined) {
  testSink = replacement;
}

// Sends one event in the background. Never throws and never waits on PostHog.
export function captureServerEvent(event: ServerAnalyticsEvent, env: Environment = process.env) {
  try {
    const target = analyticsSink(env);
    if (!target) return;
    target.capture(analyticsMessage(event, env));
    // Inside a Vercel request this keeps the function alive until the event is
    // sent; elsewhere (an eve hook outside one) the send runs unawaited.
    waitUntil(target.flush().catch(() => undefined));
  } catch {
    // Analytics never changes what the caller does.
  }
}

// The host's person properties for analytics: their handle (public on their
// page), when they signed up, their linked messaging channel and whether a
// calendar is connected. No name or email.
export async function hostAnalyticsTraits(db: Queryable, hostAccountId: string): Promise<Readonly<Record<string, string | boolean | null>>> {
  const [row] = await db<{ calendar_connected: boolean; channel: string | null; created_at: Date; handle: string | null }[]>`
    select a.created_at,
           h.handle,
           b.channel,
           (g.host_account_id is not null and g.invalidated_at is null and g.refresh_token_ciphertext is not null) as calendar_connected
    from app.host_accounts a
    left join app.host_handles h on h.host_account_id = a.id and h.released_at is null
    left join app.imessage_bindings b on b.host_account_id = a.id and b.state = 'active'
    left join app.provider_grants g on g.host_account_id = a.id
    where a.id = ${hostAccountId}
  `;

  return row
    ? {
        calendar_connected: row.calendar_connected,
        handle: row.handle,
        messaging_channel: row.channel,
        signed_up_at: row.created_at.toISOString(),
      }
    : {};
}
