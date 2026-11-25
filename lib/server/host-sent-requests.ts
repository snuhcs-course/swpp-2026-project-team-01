import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ACTIONABLE_REQUEST_STATES, type RequestDetails, type RequestState } from "../contracts/request";
import type { ConfirmedSettings } from "../contracts/setup";
import { createAccountRequest, readAccountRequester } from "./account-requests";
import { hostConversationLanguage } from "./channel-language";
import { linkedMessagingTurn } from "./channel-selection";
import { CommandError } from "./commands";
import type { Database, Queryable } from "./database";
import { emailSourceHash } from "./email-receipts";
import { encodeDisplayName } from "./entry-documents";
import { HOST_REVIEW_AUDIENCE, HOST_SETUP_AUDIENCE } from "./eve-auth";
import { bindHostConversation, handleFromText } from "./host-conversation-bindings";
import { findReadyHostByHandle } from "./readiness";
import { hostAcceptsRequests } from "./request-guard";
import { requestRef } from "./request-ref";
import { admitCreation, CREATION_LIMITS } from "./request-start";
import { appOriginFromEnvironment } from "./same-origin";
import type { SessionPrincipal } from "./setup-tools";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// One account as host and guest in its linked messenger (host-as-guest-messenger,
// testing baseline R01 M-1 to M-8, #334 and #61). A host who sends another
// host's booking link or @handle in their linked iMessage, WhatsApp or Telegram
// starts (or continues) a request to that host as the account
// (account-requests.ts: name, Google address, host timezone and calendars).
// The request's guest conversation is bound to the host conversation itself: a
// requester binding with no link, on the host binding's sender. The host
// binding's selected request then decides where free text goes, for a sent
// request as for a received one, and the request's guest notices arrive in the
// same conversation and select it. Nothing here reaches the other host.

export { handleFromText } from "./host-conversation-bindings";

// ---------------------------------------------------------------------------
// Sent requests, listed apart from received ones (R01 M-8)

export type SentRequestItem = {
  readonly requestId: string;
  readonly hostName: string;
  readonly purpose: string | null;
  readonly state: RequestState;
  readonly proposalStart: string | null;
  readonly bookedStart: string | null;
  readonly updatedAt: string;
};

// The account's sent requests, linked by a verified identity or session, never
// by a contact address; newest first. It reads only the other host's public
// display name.
export async function listSentRequests(q: Queryable, hostAccountId: string, limit: number | null = 50): Promise<SentRequestItem[]> {
  const rows = await q<{
    id: string;
    state: RequestState;
    details: Partial<RequestDetails>;
    host_name: string;
    proposal_start: Date | null;
    booking_start: Date | null;
    updated_at: Date;
  }[]>`
    select r.id, r.state, r.details, r.updated_at,
           coalesce(nullif(s.settings ->> 'displayName', ''), h.display_name, 'Host') as host_name,
           p.start_at as proposal_start, b.start_at as booking_start
    from app.requester_host_profiles m
    join app.requests r on r.id = m.request_id
    join app.host_accounts h on h.id = r.host_account_id
    left join app.host_settings s on s.host_account_id = r.host_account_id
    left join lateral (select start_at from app.proposals where request_id = r.id order by version desc limit 1) p on true
    left join lateral (
      select start_at from app.bookings where request_id = r.id and state = 'confirmed' order by updated_at desc limit 1
    ) b on true
    where m.host_account_id = ${hostAccountId} and r.state <> 'draft'
    order by r.updated_at desc, r.id desc
    limit ${limit}
  `;
  return rows.map((row) => ({
    bookedStart: row.booking_start?.toISOString() ?? null,
    hostName: row.host_name,
    proposalStart: row.proposal_start?.toISOString() ?? null,
    purpose: row.details.purpose ?? null,
    requestId: row.id,
    state: row.state,
    updatedAt: row.updated_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// start_request (R01 M-1, M-1.1 and M-2)

export const startRequestToolInput = z
  .object({
    to: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe("The other host's booking link (findmeatime.com/dodo) or @handle, as the host wrote it."),
    another: z
      .boolean()
      .default(false)
      .describe("True only when the host asks for another, separate meeting with a host they already have an open request with."),
  })
  .strict();

export type StartRequestCall = { readonly auth: SessionPrincipal; readonly sessionId: string; readonly callId: string };

export type StartRequestDependencies = {
  readonly db: Database;
  readonly appOrigin: string;
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
};

export function startRequestDependenciesFromEnvironment(db: Database): StartRequestDependencies {
  const tokenKey = tokenKeyFromEnvironment();
  return { appOrigin: appOriginFromEnvironment(), db, tokenKey, tokenKeys: [tokenKey] };
}

export const START_REQUEST_DESCRIPTION =
  "Start a meeting request to another host for this host, as their account, when they send that host's booking link or @handle in their linked iMessage, WhatsApp or Telegram, or ask to meet them (\"findmeatime.com/dodo\", \"Book a meeting with @dodo next week\"). Pass the link or handle as written. Their account's name, Google address, timezone and host calendars are used; ask nothing about them. An open request with that host continues; pass another true only when they ask for another, separate meeting. Read it by ref with get_sent_request in this same account session; use the sent-request tools for its requester actions. Their own link starts nothing (own): say it is their booking link and offer to share it. Never treat a link as a change to their own settings, and never send them to the web page to start.";

type Started =
  | {
      readonly started: true;
      readonly continued: boolean;
      readonly ref: string;
      readonly host: string;
      readonly offers: { readonly durationMinutes: number | null; readonly meetingMode: string | null };
      readonly calendars: readonly string[];
      readonly calendarReadable: boolean;
      readonly message: string;
    }
  | { readonly started: false; readonly own?: true; readonly problem: string };

const UNAVAILABLE = 'No host is taking requests at that link. Tell the host neutrally: "I can\'t find a host taking requests at that link." Create nothing.';
const uuid = z.uuid();

export async function startRequestForTool(deps: StartRequestDependencies, call: StartRequestCall, input: z.infer<typeof startRequestToolInput>): Promise<Started> {
  const hostAccountId = uuid.safeParse(call.auth?.principalId);
  const audience = call.auth?.attributes?.audience;
  if (call.auth?.principalType !== "user" || !hostAccountId.success || (audience !== HOST_SETUP_AUDIENCE && audience !== HOST_REVIEW_AUDIENCE)) {
    return { problem: "This conversation cannot start requests.", started: false };
  }
  const me = hostAccountId.data;

  const turn = await linkedMessagingTurn(deps.db, call.sessionId, me);
  if (!turn) {
    return { problem: "Starting a request in words works only from the host's linked iMessage, WhatsApp or Telegram. On the web, the host opens the other host's booking link.", started: false };
  }

  const handle = handleFromText(input.to, deps.appOrigin);
  if (!handle) return { problem: "That is not a booking link or @handle. Ask the host which host they want to meet.", started: false };

  const [owner] = await deps.db<{ host_account_id: string }[]>`
    select host_account_id from app.host_handles where handle = ${handle} and released_at is null
  `;
  if (owner?.host_account_id === me) {
    return { own: true, problem: "This is the host's own booking link. Say so and offer to share it with the people who want to meet them; create no request.", started: false };
  }
  const target = await findReadyHostByHandle(deps.db, handle);
  if (!target) return { problem: UNAVAILABLE, started: false };

  const account = await readAccountRequester(deps.db, me);
  if (!account) return { problem: "This account cannot send requests now.", started: false };
  if (!account.timezone) return { problem: "The host's own timezone is not set yet. Ask them to finish setup first; nothing was created.", started: false };

  const dedupeKey = `host-start:${call.sessionId}:${call.callId}`;
  try {
    const outcome = await deps.db.begin(async (tx) => {
      // A replayed call finds the request it started.
      const [replayed] = await tx<{ request_id: string }[]>`
        select request_id from app.imessage_outbox where dedupe_key = ${dedupeKey} and request_id is not null
      `;
      let requestId = replayed?.request_id ?? null;
      // Two starts with the same host at once make one request.
      await tx`select pg_advisory_xact_lock(hashtextextended(${`app.host_start:${me}:${target.hostAccountId}`}, 0))`;
      let continued = Boolean(replayed);

      if (!requestId && !input.another) {
        const [open] = await tx<{ id: string }[]>`
          select r.id from app.requester_host_profiles p
          join app.requests r on r.id = p.request_id
          join app.booking_links l on l.request_id = r.id and l.expires_at > now()
          where p.host_account_id = ${me} and r.host_account_id = ${target.hostAccountId}
            and r.state::text = any(${[...ACTIONABLE_REQUEST_STATES]}::text[])
          order by r.updated_at desc limit 1
        `;
        if (open) {
          requestId = open.id;
          continued = true;
        }
      }

      if (!requestId) {
        if (!(await hostAcceptsRequests(tx, target.hostAccountId))) throw new CommandError("forbidden");
        const sourceHash = emailSourceHash(deps.tokenKey, account.email);
        await admitCreation(tx, sourceHash, CREATION_LIMITS);
        requestId = await createAccountRequest(
          tx,
          { origin: deps.appOrigin, tokenKey: deps.tokenKey },
          account,
          target.hostAccountId,
          sourceHash,
          { language: await hostConversationLanguage(tx, me) },
          { correlationId: randomUUID(), retryKey: dedupeKey },
        );
      }

      const bindingId = await bindHostConversation(tx, deps, {
        hostAccountId: me,
        hostName: target.displayName,
        requestId,
        select: true,
        welcome: false,
      });
      if (!bindingId) throw new CommandError("unavailable_configuration");
      // Marks the call as done, for a replay; the turn's reply is the message.
      await tx`
        insert into app.imessage_outbox (channel, dedupe_key, kind, state, recipient_hash, request_id, requester_binding_id, completed_at)
        select channel, ${dedupeKey}, 'signal', 'suppressed', sender_hash, ${requestId}, ${bindingId}, now()
        from app.requester_imessage_bindings where id = ${bindingId}
        on conflict do nothing
      `;
      return { continued, requestId };
    });

    const [offers] = await deps.db<{ settings: Pick<ConfirmedSettings, "durationMinutes" | "meetingMode"> }[]>`
      select settings from app.host_settings where host_account_id = ${target.hostAccountId}
    `;
    const name = encodeDisplayName(target.displayName);
    return {
      calendarReadable: account.calendarReadable,
      calendars: account.calendars.map(encodeDisplayName),
      continued: outcome.continued,
      host: name,
      message: [
        outcome.continued
          ? `The host already has an open request with ${name}; it continues. Say so.`
          : `A request to ${name} was started for the host as their account; the private link was emailed to their account address.`,
        `Tell the host which request with ${name} was started or continued, then use get_sent_request with its ref. Stay in the account session; do not switch roles or sessions.`,
        account.calendars.length === 0
          ? "No host calendars count for this request."
          : account.calendarReadable
            ? `Say once which of their calendars count for busy times: "I'll check your calendars {calendars} for busy times."`
            : `Their calendars count, but their Google Calendar must be reconnected first at ${deps.appOrigin}/auth/sign-in?consent=calendar; ask them to. Times are never searched as if they were free.`,
        outcome.continued ? "Ask what they want to do next on it." : "Ask what the meeting is about, mentioning the other host's usual length and mode (offers).",
        "Never show their own settings or events to the other host.",
      ].join(" "),
      offers: { durationMinutes: offers?.settings.durationMinutes ?? null, meetingMode: offers?.settings.meetingMode ?? null },
      ref: requestRef(outcome.requestId),
      started: true,
    };
  } catch (error) {
    if (error instanceof CommandError) {
      if (error.category === "forbidden") return { problem: UNAVAILABLE, started: false };
      if (error.category === "unavailable_configuration") return { problem: "This conversation is no longer linked; nothing was created.", started: false };
      if (error.category !== "rate_limited") return { problem: "The request could not be started; nothing was created. Ask the host to try again.", started: false };
      return { problem: "Too many requests were started just now. Ask the host to try again later; nothing was created.", started: false };
    }
    throw error;
  }
}
