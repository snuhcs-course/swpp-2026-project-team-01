import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { GROUP_OPEN_EXPIRY } from "../contracts/group-meeting";
import type { RequestLanguage } from "../contracts/request";
import { isValidTimeZone } from "../contracts/timezone";
import { type CommandDefinition, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import { publishJob } from "./jobs";
import { admitCreation, insertDraftRequest, NETWORK_CREATION_LIMITS, START_REQUEST_OPERATION, startRequestInput, type StartRequestInput } from "./request-start";
import { hostAcceptsRequests } from "./request-guard";
import { closeRequest } from "./request-lifecycle";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

// Group meetings (group-scheduling design 1, 2 and 5). A host creates one in
// words from their linked messenger conversation, with the purpose, length, a
// date range and the number of participants; Thyme sends one shared link. Each
// person who opens it gets their own participant request (requests.
// group_meeting_id), which reuses the booking link, the requester grants, the
// guest thread and the messenger binding of any request. Participant requests
// are invisible to every host projection, list and count (D18): the host hears
// nothing until the group closes, and can ask how it is going.
//
// While the group is collecting, its participant requests and their booking
// links carry the far-future GROUP_OPEN_EXPIRY, so they never expire (D14);
// the close gives the done participants the ordinary seven and thirty days
// from then and closes everyone still in progress.

export { GROUP_OPEN_EXPIRY };
export const GROUP_CLOSE_JOB = "group_close";
export const GROUP_REQUEST_LIFETIME_DAYS = 7;
export const GROUP_LINK_LIFETIME_DAYS = 30;
export const MAX_GROUP_PARTICIPANTS = 20;
export const MAX_GROUP_RANGE_DAYS = 31;

// The shared link's token: 32 random bytes in base64url. Lookup uses its SHA-256.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isGroupToken(value: string) {
  return TOKEN.test(value);
}

export function hashGroupToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function groupLinkContext(groupId: string) {
  return `group_meeting_link:${groupId}`;
}

export function groupUrl(origin: string, token: string) {
  return `${origin.replace(/\/+$/, "")}/g/${token}`;
}

export function openGroupToken(keys: readonly TokenKey[], group: { readonly id: string; readonly link_ciphertext: string; readonly link_key_id: string }) {
  return openToken(keys, { ciphertext: group.link_ciphertext, keyId: group.link_key_id }, groupLinkContext(group.id));
}

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const groupTermsSchema = z
  .object({
    purpose: z.string().trim().min(1).max(200),
    durationMinutes: z.number().int().min(5).max(480),
    rangeStart: localDate,
    rangeEnd: localDate,
    participants: z.number().int().min(1).max(MAX_GROUP_PARTICIPANTS),
  })
  .strict();

export type GroupTerms = z.infer<typeof groupTermsSchema>;

export type GroupTermsProblem = "range_reversed" | "range_too_long" | "range_past";

function dayNumber(date: string) {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

// A range that ends before it starts, is longer than MAX_GROUP_RANGE_DAYS, or
// ends before today in the host's timezone cannot be searched.
export function groupTermsProblem(terms: Pick<GroupTerms, "rangeStart" | "rangeEnd">, today: string): GroupTermsProblem | null {
  if (dayNumber(terms.rangeEnd) < dayNumber(terms.rangeStart)) return "range_reversed";
  if (dayNumber(terms.rangeEnd) - dayNumber(terms.rangeStart) + 1 > MAX_GROUP_RANGE_DAYS) return "range_too_long";
  if (dayNumber(terms.rangeEnd) < dayNumber(today)) return "range_past";
  return null;
}

export type GroupRow = {
  readonly id: string;
  readonly host_account_id: string;
  readonly state: "collecting" | "closed" | "booking" | "booked" | "cancelled";
  readonly purpose: string;
  readonly duration_minutes: number;
  readonly range_start: string;
  readonly range_end: string;
  readonly timezone: string;
  readonly language: RequestLanguage;
  readonly participant_limit: number;
  readonly link_ciphertext: string;
  readonly link_key_id: string;
  readonly notice_shown: number;
  readonly chosen_position: number | null;
  readonly calendar_id: string | null;
  readonly event_id: string | null;
  readonly created_at: Date;
  readonly closed_at: Date | null;
};

const GROUP_COLUMNS = (q: Queryable) => q`
  id, host_account_id, state, purpose, duration_minutes, to_char(range_start, 'YYYY-MM-DD') as range_start,
  to_char(range_end, 'YYYY-MM-DD') as range_end, timezone, language, participant_limit, link_ciphertext,
  link_key_id, notice_shown, chosen_position, calendar_id, event_id, created_at, closed_at
`;

export async function readGroup(q: Queryable, groupId: string, options: { readonly lock?: boolean } = {}) {
  const [row] = await q<GroupRow[]>`
    select ${GROUP_COLUMNS(q)} from app.group_meetings where id = ${groupId}
    ${options.lock ? q`for update` : q``}
  `;
  return row ?? null;
}

export async function findGroupByToken(q: Queryable, token: string) {
  if (!isGroupToken(token)) return null;
  const [row] = await q<GroupRow[]>`
    select ${GROUP_COLUMNS(q)} from app.group_meetings where link_hash = ${hashGroupToken(token)}
  `;
  return row ?? null;
}

// The group a participant request belongs to, or null for any other request.
export async function groupOfRequest(q: Queryable, requestId: string, options: { readonly lock?: boolean } = {}) {
  const [row] = await q<GroupRow[]>`
    select ${GROUP_COLUMNS(q)} from app.group_meetings
    where id = (select group_meeting_id from app.requests where id = ${requestId})
    ${options.lock ? q`for update` : q``}
  `;
  return row ?? null;
}

// Writes the group and its sealed link in the caller's transaction, and
// returns the token for the reply that carries the link.
export async function insertGroupMeeting(
  tx: Transaction,
  group: {
    readonly hostAccountId: string;
    readonly terms: GroupTerms;
    readonly timezone: string;
    readonly language: RequestLanguage;
    readonly tokenKey: TokenKey;
  },
) {
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const sealed = sealToken(group.tokenKey, token, groupLinkContext(id));
  await tx`
    insert into app.group_meetings
      (id, host_account_id, purpose, duration_minutes, range_start, range_end, timezone, language, participant_limit,
       link_hash, link_ciphertext, link_key_id)
    values
      (${id}, ${group.hostAccountId}, ${group.terms.purpose}, ${group.terms.durationMinutes}, ${group.terms.rangeStart},
       ${group.terms.rangeEnd}, ${group.timezone}, ${group.language}, ${group.terms.participants},
       ${hashGroupToken(token)}, ${sealed.ciphertext}, ${sealed.keyId})
  `;
  return { id, token };
}

// ---------------------------------------------------------------------------
// Opening the shared link

// request.start for a group's shared link: the same draft, bounds and nonce
// retry as a host's public page, but in the group, holding its terms, and
// with a booking link that does not expire while the group collects. A full
// or closed group starts nothing (forbidden). resourceId is the group.
export function startGroupParticipantCommand(options: {
  readonly tokenKey: TokenKey;
  readonly sourceHash: string;
}): CommandDefinition<StartRequestInput, { readonly requestId: string }> {
  return {
    input: startRequestInput,
    operation: `${START_REQUEST_OPERATION}.group`,
    async run(tx, context) {
      if (context.actor.kind !== "guest_starter") throw new CommandError("forbidden");
      const group = await readGroup(tx, context.resourceId, { lock: true });
      if (!group || group.state !== "collecting") throw new CommandError("forbidden");
      if ((await doneCount(tx, group.id)) >= group.participant_limit) throw new CommandError("forbidden");
      if (!(await hostAcceptsRequests(tx, group.host_account_id))) throw new CommandError("forbidden");

      await admitCreation(tx, options.sourceHash, NETWORK_CREATION_LIMITS);
      const requestId = await insertDraftRequest(tx, {
        group: {
          durationMinutes: group.duration_minutes,
          id: group.id,
          purpose: group.purpose,
          rangeEnd: group.range_end,
          rangeStart: group.range_start,
          timezone: group.timezone,
        },
        hostAccountId: group.host_account_id,
        language: context.input.language,
        sourceHash: options.sourceHash,
        timezone: context.input.timezone,
        tokenKey: options.tokenKey,
      });
      return { requestId };
    },
  };
}

// ---------------------------------------------------------------------------
// Progress and closing

export async function doneCount(q: Queryable, groupId: string) {
  const [row] = await q<{ count: number }[]>`
    select count(*)::int as count from app.group_participants p
    join app.requests r on r.id = p.request_id
    where r.group_meeting_id = ${groupId} and p.done_at is not null
  `;
  return row?.count ?? 0;
}

export type GroupProgress = {
  readonly groupId: string;
  readonly purpose: string;
  readonly state: GroupRow["state"];
  readonly done: number;
  readonly participants: number;
  readonly doneNames: readonly string[];
};

// The host's groups that have not been booked or cancelled, newest first, with
// how many participants are done and their names (D18). In-progress people are
// not counted or named.
export async function readGroupProgress(q: Queryable, hostAccountId: string): Promise<GroupProgress[]> {
  const rows = await q<{ done_names: string[] | null; id: string; participant_limit: number; purpose: string; state: GroupRow["state"] }[]>`
    select g.id, g.purpose, g.state, g.participant_limit,
           (select array_agg(r.requester_name order by p.done_at) from app.requests r
            join app.group_participants p on p.request_id = r.id
            where r.group_meeting_id = g.id and p.done_at is not null) as done_names
    from app.group_meetings g
    where g.host_account_id = ${hostAccountId} and g.state in ('collecting', 'closed', 'booking')
    order by g.created_at desc
    limit 5
  `;
  return rows.map((row) => ({
    done: row.done_names?.length ?? 0,
    doneNames: row.done_names ?? [],
    groupId: row.id,
    participants: row.participant_limit,
    purpose: row.purpose,
    state: row.state,
  }));
}

// Closes a collecting group locked by the caller: from the last participant's
// confirmation, or the host's early close. Participants still in progress are
// closed as expired (they are told the meeting is full); the done ones get the
// ordinary lifetimes from now; the group_close job then finds the options and
// tells the host. Returns false when the group was not collecting.
export async function closeGroup(tx: Transaction, groupId: string) {
  const closed = await tx`
    update app.group_meetings set state = 'closed', closed_at = now(), updated_at = now()
    where id = ${groupId} and state = 'collecting'
  `;
  if (closed.count === 0) return false;

  const pending = await tx<{ id: string; state: string }[]>`
    select r.id, r.state from app.requests r
    left join app.group_participants p on p.request_id = r.id
    where r.group_meeting_id = ${groupId} and r.closed_at is null and p.done_at is null
    for update of r
  `;
  for (const request of pending) {
    if (request.state === "draft") {
      // A draft is deleted by the expiry sweep, as any draft is.
      await tx`update app.requests set expires_at = least(expires_at, now()) where id = ${request.id}`;
    } else {
      await closeRequest(tx, request.id, "expired");
    }
  }

  await tx`
    update app.requests r
    set expires_at = now() + make_interval(days => ${GROUP_REQUEST_LIFETIME_DAYS}), updated_at = now()
    from app.group_participants p
    where p.request_id = r.id and r.group_meeting_id = ${groupId} and p.done_at is not null and r.closed_at is null
  `;
  await tx`
    update app.booking_links l set expires_at = now() + make_interval(days => ${GROUP_LINK_LIFETIME_DAYS})
    from app.requests r
    where r.id = l.request_id and r.group_meeting_id = ${groupId} and l.expires_at = ${GROUP_OPEN_EXPIRY}
  `;
  await publishJob(tx, { dedupeKey: `group:${groupId}`, kind: GROUP_CLOSE_JOB, payload: { groupId } });
  return true;
}

// The host's early close in words (group-scheduling: Host closes the group
// early). With no participant done it changes nothing.
export async function closeGroupEarly(tx: Transaction, hostAccountId: string, groupId: string) {
  const group = await readGroup(tx, groupId, { lock: true });
  if (!group || group.host_account_id !== hostAccountId) return { closed: false as const, problem: "not_found" as const };
  if (group.state !== "collecting") return { closed: false as const, problem: "not_collecting" as const };
  if ((await doneCount(tx, groupId)) === 0) return { closed: false as const, problem: "nobody_done" as const };
  await closeGroup(tx, groupId);
  return { closed: true as const };
}

export function groupTimezone(zone: string | null | undefined) {
  return zone && isValidTimeZone(zone) ? zone : "UTC";
}
