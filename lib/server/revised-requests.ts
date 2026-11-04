import { REVISED_SUMMARY_PREFIX, type RequestDetails } from "../contracts/request";
import { CommandError } from "./commands";
import { issueContactConfirmation } from "./contact-confirmation";
import { displayTime, isValidTimeZone } from "../contracts/timezone";
import type { Queryable, Transaction } from "./database";
import { requestRef } from "./request-ref";
import { hostAcceptsRequests } from "./request-guard";
import { requestExpiresAt } from "./request-lifecycle";
import { admitCreation, CREATION_LIMITS, type CreationLimits, insertDraftRequest } from "./request-start";
import { requesterBindingContext } from "./requester-imessage-bindings";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

// Revised requests (guest-flow-completion design 5, D5, D6). The bound guest's
// next message in the email thread or iMessage conversation of a request that
// closed as declined, expired or withdrawn (U16) starts a new request with the
// same host, in one transaction:
//   - the host must still accept requests, the closed request must have no
//     revised request yet (requests.revised_from_request_id is unique, so a
//     retried receipt or a reply in the other channel finds the one there is),
//     the chain from the first request must hold fewer than 10 requests, and
//     the creation bounds must admit it, counted per keyed hash of the contact;
//   - the new request is identified at once, with the earlier one's purpose,
//     duration, mode, place or link plan, travel mode, timezone, language, name
//     and contact (confirmed when it was), the guest's windows that are still
//     ahead, and the excluded times (U17: its own and the declined time,
//     never a reason), but no evaluations, proposals, agreements
//     or approvals; its creation email sends the new booking link, and the
//     host gets the new-request notice;
//   - the channel follows: the email thread is re-bound in place, or the guest
//     binding becomes moved and a new active binding carries the same sender.
// The caller then records the opening summary and forwards the message.

export const REVISED_CHAIN_LIMIT = 10;

export type RevisedChannel =
  | { readonly kind: "email"; readonly threadId: string; readonly receiptId: string; readonly messageId: string }
  | { readonly kind: "imessage"; readonly bindingId: string };

export type RevisedOutcome =
  | { readonly kind: "created" | "existing"; readonly requestId: string; readonly bindingId: string | null }
  | { readonly kind: "refused" };

export type RevisedOptions = {
  readonly origin: string;
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
  readonly creationLimits?: Partial<CreationLimits>;
};

type ClosedRequest = {
  readonly id: string;
  readonly host_account_id: string;
  readonly state: string;
  readonly details: RequestDetails;
  readonly requester_name: string | null;
  readonly contact_email: string | null;
  readonly contact_confirmed_email: string | null;
};

export function isRevisable(state: string) {
  return state === "declined" || state === "expired" || state === "withdrawn";
}

const ENDINGS: Readonly<Record<string, string>> = {
  declined: "was declined by the host",
  expired: "expired",
  withdrawn: "was withdrawn by the guest",
};

type Interval = { readonly start: string; readonly end: string };

function stillAhead(intervals: readonly Interval[] | undefined, now: number) {
  return (intervals ?? []).filter((entry) => Date.parse(entry.end) > now);
}

// The summary the revised discussion opens with: the earlier request's details,
// the times proposed in it, how it ended, and the times now left out (U17),
// never the host's notes, rules, reasons or discussion.
export function revisedSummary(earlier: Pick<ClosedRequest, "id" | "state" | "details">, proposed: readonly Interval[] = []) {
  const details = earlier.details;
  const zone = details.timezone && isValidTimeZone(details.timezone) ? details.timezone : "UTC";
  const time = (entry: Interval) => `${displayTime(new Date(entry.start), zone)} to ${displayTime(new Date(entry.end), zone)}`;
  const lines = [
    `${REVISED_SUMMARY_PREFIX}.`,
    `The guest's earlier request ${requestRef(earlier.id)} ${ENDINGS[earlier.state] ?? "closed"}, and the guest wrote again, so this is a new request with the same host.`,
  ];
  if (details.purpose) lines.push(`Purpose: ${details.purpose}`);
  if (details.durationMinutes) lines.push(`Length: ${details.durationMinutes} minutes`);
  if (details.mode === "online") lines.push("Mode: online");
  if (details.mode === "in_person") lines.push(`Mode: in person${details.location ? ` at ${details.location}` : ""}`);
  if (proposed.length > 0) lines.push(`Times proposed before: ${proposed.map(time).join("; ")}`);
  if (details.windows?.length) lines.push(`The guest's preferred times, carried over: ${details.windows.map(time).join("; ")}`);
  if (details.excludedTimes?.length) {
    lines.push(`These times no longer work for the host and are left out of the search; never give or guess a reason: ${details.excludedTimes.map(time).join("; ")}`);
  }
  lines.push("Find new times with the guest.");
  return lines.join("\n");
}

// The summary for a closed request, read with the times proposed in it.
export async function readRevisedSummary(q: Queryable, closedRequestId: string) {
  const [earlier] = await q<Pick<ClosedRequest, "id" | "state" | "details">[]>`
    select id, state, details from app.requests where id = ${closedRequestId}
  `;
  if (!earlier) return null;
  const proposed = await q<{ end_at: Date; start_at: Date }[]>`
    select start_at, end_at from app.proposals where request_id = ${closedRequestId} order by version
  `;
  return revisedSummary(earlier, proposed.map((row) => ({ end: row.end_at.toISOString(), start: row.start_at.toISOString() })));
}

async function chainLength(tx: Transaction, requestId: string) {
  const [row] = await tx<{ length: number }[]>`
    with recursive chain (id, previous, depth) as (
      select id, revised_from_request_id, 1 from app.requests where id = ${requestId}
      union all
      select r.id, r.revised_from_request_id, c.depth + 1 from app.requests r join chain c on r.id = c.previous
      where c.depth < ${REVISED_CHAIN_LIMIT + 1}
    )
    select max(depth)::int as length from chain
  `;
  return row?.length ?? 1;
}

async function existingRevision(tx: Transaction, closedRequestId: string) {
  const [row] = await tx<{ id: string }[]>`select id from app.requests where revised_from_request_id = ${closedRequestId}`;
  return row?.id ?? null;
}

async function activeGuestBindingOf(tx: Transaction, requestId: string) {
  const [row] = await tx<{ id: string }[]>`
    select id from app.requester_imessage_bindings where request_id = ${requestId} and state = 'active'
  `;
  return row?.id ?? null;
}

// Moves the channel to the revised request.
async function moveChannel(tx: Transaction, options: RevisedOptions, channel: RevisedChannel, closedRequestId: string, requestId: string) {
  if (channel.kind === "email") {
    await tx`
      update app.email_threads
      set request_id = ${requestId}, bound_by_receipt_id = ${channel.receiptId}, last_message_id = ${channel.messageId},
          closed_notice_at = null
      where id = ${channel.threadId} and request_id = ${closedRequestId} and state = 'active'
    `;
    return null;
  }

  const [old] = await tx<{ id: string; sender_hash: string; sender_ciphertext: string; space_ciphertext: string | null; sealed_key_id: string; link_id: string | null }[]>`
    select id, sender_hash, sender_ciphertext, space_ciphertext, sealed_key_id, link_id from app.requester_imessage_bindings
    where id = ${channel.bindingId} and request_id = ${closedRequestId} and state = 'active'
    for update
  `;
  if (!old) return null;

  const open = (ciphertext: string) => openToken(options.tokenKeys, { ciphertext, keyId: old.sealed_key_id }, requesterBindingContext(old.id));
  const sender = open(old.sender_ciphertext);
  const space = old.space_ciphertext ? open(old.space_ciphertext) : null;
  await tx`
    update app.requester_imessage_bindings
    set state = 'moved', moved_to_request_id = ${requestId}, ended_at = now(), sender_ciphertext = null, space_ciphertext = null
    where id = ${old.id}
  `;
  const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
  const context = requesterBindingContext(row!.id);
  await tx`
    insert into app.requester_imessage_bindings (id, request_id, link_id, sender_hash, sender_ciphertext, space_ciphertext, sealed_key_id)
    values (${row!.id}, ${requestId}, ${old.link_id}, ${old.sender_hash}, ${sealToken(options.tokenKey, sender, context).ciphertext},
            ${space === null ? null : sealToken(options.tokenKey, space, context).ciphertext}, ${options.tokenKey.id})
  `;
  return row!.id;
}

// The revised request for a closed request, created or found. sourceHash is the
// keyed hash of the earlier request's contact address, the creation bounds' key.
export async function reviseClosedRequest(
  tx: Transaction,
  options: RevisedOptions,
  closedRequestId: string,
  channel: RevisedChannel,
  sourceHash: (address: string) => string,
): Promise<RevisedOutcome> {
  const [closed] = await tx<ClosedRequest[]>`
    select id, host_account_id, state, details, requester_name, contact_email, contact_confirmed_email
    from app.requests where id = ${closedRequestId}
    for update
  `;
  if (!closed || !isRevisable(closed.state) || !closed.contact_email || !closed.requester_name) return { kind: "refused" };

  // A retried receipt finds the channel already moved; a reply in the other
  // channel moves that one too.
  const existing = await existingRevision(tx, closed.id);
  if (existing) {
    const moved = await moveChannel(tx, options, channel, closed.id, existing);
    return { bindingId: channel.kind === "imessage" ? (moved ?? (await activeGuestBindingOf(tx, existing))) : null, kind: "existing", requestId: existing };
  }

  if (!(await hostAcceptsRequests(tx, closed.host_account_id))) return { kind: "refused" };
  if ((await chainLength(tx, closed.id)) >= REVISED_CHAIN_LIMIT) return { kind: "refused" };

  const source = sourceHash(closed.contact_email);
  try {
    await admitCreation(tx, source, { ...CREATION_LIMITS, ...options.creationLimits });
  } catch (error) {
    if (error instanceof CommandError && error.category === "rate_limited") return { kind: "refused" };
    throw error;
  }

  const earlier = closed.details;
  // A declined request's last proposed time no longer works for the host
  // (U17).
  const [declined] =
    closed.state === "declined"
      ? await tx<{ end_at: Date; start_at: Date }[]>`
          select start_at, end_at from app.proposals where request_id = ${closed.id} order by version desc limit 1
        `
      : [];
  const requestId = await insertDraftRequest(tx, {
    hostAccountId: closed.host_account_id,
    language: earlier.language ?? "en",
    sourceHash: source,
    timezone: earlier.timezone ?? "UTC",
    tokenKey: options.tokenKey,
  });
  const details: RequestDetails = {
    durationMinutes: earlier.durationMinutes ?? null,
    language: earlier.language ?? "en",
    linkPlan: earlier.linkPlan ?? null,
    location: earlier.location ?? null,
    mode: earlier.mode ?? null,
    purpose: earlier.purpose ?? null,
    timezone: earlier.timezone ?? "UTC",
    travelMode: earlier.travelMode ?? null,
    // The guest's windows and the excluded times still ahead (U17).
    windows: stillAhead(earlier.windows, Date.now()),
    excludedTimes: stillAhead(
      [...(earlier.excludedTimes ?? []), ...(declined ? [{ end: declined.end_at.toISOString(), start: declined.start_at.toISOString() }] : [])],
      Date.now(),
    ),
  };
  const confirmed =
    closed.contact_confirmed_email && closed.contact_confirmed_email.toLowerCase() === closed.contact_email.toLowerCase()
      ? closed.contact_email
      : null;
  await tx`
    update app.requests
    set state = 'gathering', requester_name = ${closed.requester_name}, contact_email = ${closed.contact_email},
        contact_confirmed_email = ${confirmed}, details = ${tx.json(details as unknown as Parameters<typeof tx.json>[0])},
        identified_at = now(), identity_requested_at = now(), revised_from_request_id = ${closed.id},
        expires_at = ${requestExpiresAt(new Date())}, revision = revision + 1, updated_at = now()
    where id = ${requestId}
  `;

  await issueContactConfirmation(tx, { origin: options.origin, requestId, tokenKey: options.tokenKey });
  // As for a new request, the host hears at approval, where the summary names
  // the request this one follows (#122).

  return { bindingId: await moveChannel(tx, options, channel, closed.id, requestId), kind: "created", requestId };
}
