import { createHash } from "node:crypto";
import { z } from "zod";
import type { GroupParticipantView, GroupReview, GroupStep, GroupUnavailableTime } from "../contracts/group-meeting";
import { REQUESTER_TRAVEL_MODES, type RequesterTravelMode } from "../contracts/request";
import { clockSchema } from "../contracts/setup";
import { isValidTimeZone, localDate } from "../contracts/timezone";
import { canonicalJson, type CommandDefinition, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import { addDays, normalizeBusy, startOfLocalDay } from "./feasibility";
import type { CalendarEvent, GoogleCalendarConfig } from "./google-calendar";
import { closeGroup, doneCount, groupOfRequest, type GroupRow } from "./group-meetings";
import { assertIdentified, lockOpenRequest } from "./request-guard";
import { readRequesterCalendarGrant, readRequesterEvents, requesterCalendarConfigFromEnvironment } from "./requester-calendar";
import type { TokenKey } from "./token-encryption";

// A group participant's steps after identity and Calendar (group-scheduling
// design 3 and 4): one question (preferred hours, usual place, travel mode and
// commitments the calendar does not show), then a review of the times they
// cannot meet within the group's range, which they confirm or correct in
// words. Confirming stores each listed interval with its start, end, all-day
// flag and, for a calendar event, its place, and marks them done; nothing they
// answered changes after that (D13), and the close and the booking use what
// they confirmed without reading their calendar again (D11). No event title,
// attendee or description is stored, and nothing here is shown to the host or
// another participant.

export type ParticipantRow = {
  readonly request_id: string;
  readonly timezone: string;
  readonly preferred_hours: readonly { readonly start: string; readonly end: string }[];
  readonly usual_place: string | null;
  readonly travel_mode: RequesterTravelMode | null;
  readonly commitments: readonly Commitment[];
  readonly answered_at: Date | null;
  readonly done_at: Date | null;
  readonly calendar_settled_at: Date | null;
  readonly state: string;
};

export async function readParticipant(q: Queryable, requestId: string, options: { readonly lock?: boolean } = {}) {
  const [row] = await q<ParticipantRow[]>`
    select p.request_id, coalesce(r.details ->> 'timezone', 'UTC') as timezone, p.preferred_hours, p.usual_place,
           p.travel_mode, p.commitments, p.answered_at, p.done_at, r.calendar_settled_at, r.state
    from app.group_participants p join app.requests r on r.id = p.request_id
    where p.request_id = ${requestId}
    ${options.lock ? q`for update of p` : q``}
  `;
  return row ? { ...row, timezone: isValidTimeZone(row.timezone) ? row.timezone : "UTC" } : null;
}

// The participant's current step, or null before identity and Calendar or
// once the request is closed.
export function participantStep(row: Pick<ParticipantRow, "answered_at" | "done_at" | "calendar_settled_at" | "state">): GroupStep | null {
  if (row.state !== "gathering") return null;
  if (row.done_at) return "done";
  if (!row.calendar_settled_at) return null;
  return row.answered_at ? "review" : "question";
}

export async function readParticipantView(q: Queryable, requestId: string): Promise<GroupParticipantView | null> {
  const group = await groupOfRequest(q, requestId);
  const participant = group ? await readParticipant(q, requestId) : null;
  if (!group || !participant) return null;
  return {
    durationMinutes: group.duration_minutes,
    full: group.state !== "collecting" && !participant.done_at,
    purpose: group.purpose,
    rangeEnd: group.range_end,
    rangeStart: group.range_start,
    step: participantStep(participant),
  };
}

// Throws unless the request is a group participant who is not done yet.
async function lockAnswering(tx: Transaction, requestId: string) {
  const request = await lockOpenRequest(tx, requestId);
  assertIdentified(request);
  const group = await groupOfRequest(tx, requestId, { lock: true });
  const participant = group ? await readParticipant(tx, requestId, { lock: true }) : null;
  if (!group || !participant) throw new CommandError("forbidden");
  if (participant.done_at) throw new CommandError("forbidden", { reason: "group_participant_done" });
  if (group.state !== "collecting") throw new CommandError("request_closed");
  return { group, participant };
}

// For the request tools and commands that change a request's answers: a done
// participant's answers no longer change (D13).
export async function assertGroupAnswersOpen(q: Queryable, requestId: string) {
  const [row] = await q<{ done: boolean }[]>`
    select p.done_at is not null as done from app.group_participants p where p.request_id = ${requestId}
  `;
  if (row?.done) throw new CommandError("forbidden", { reason: "group_participant_done" });
}

// The request commands that change meeting details, find or pick times or
// agree refuse a group's participant: the terms are the host's, and the host
// chooses the time (group-scheduling: Participant flow without picking a date).
export async function refuseGroupRequest(q: Queryable, requestId: string) {
  const [row] = await q<{ grouped: boolean }[]>`select group_meeting_id is not null as grouped from app.requests where id = ${requestId}`;
  if (row?.grouped) throw new CommandError("forbidden", { reason: "group_terms_fixed" });
}

export const GROUP_TERMS_MESSAGE = "Nothing changed: the host set this group meeting's terms, and the host picks the time for everyone.";

// ---------------------------------------------------------------------------
// The one question

const instant = z.iso.datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const commitmentSchema = z.union([
  z.object({ allDay: z.literal(false), start: instant, end: instant }).strict(),
  // Local dates in the participant's timezone, end exclusive.
  z.object({ allDay: z.literal(true), start: date, end: date }).strict(),
]);

export type Commitment = z.infer<typeof commitmentSchema>;

export const groupAnswersInput = z
  .object({
    preferredHours: z.array(z.object({ start: clockSchema, end: clockSchema }).strict()).max(7).optional(),
    usualPlace: z.string().trim().min(1).max(200).nullable().optional(),
    travelMode: z.enum(REQUESTER_TRAVEL_MODES).nullable().optional(),
    // The whole list of stated commitments, replacing the earlier one.
    commitments: z.array(commitmentSchema).max(50).optional(),
  })
  .strict();

export type GroupAnswersInput = z.infer<typeof groupAnswersInput>;

function commitmentInterval(commitment: Commitment, timezone: string) {
  return commitment.allDay
    ? { end: startOfLocalDay(commitment.end, timezone), start: startOfLocalDay(commitment.start, timezone) }
    : { end: Date.parse(commitment.end), start: Date.parse(commitment.start) };
}

// request.group.answer: the participant's answer to the one question, and any
// correction in words on the review. Each omitted field is left as it is; the
// first answer moves them to the review.
export const recordGroupAnswersCommand: CommandDefinition<GroupAnswersInput, { readonly step: GroupStep }> = {
  input: groupAnswersInput,
  operation: "request.group.answer",
  async run(tx, context) {
    if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) throw new CommandError("forbidden");
    const { participant } = await lockAnswering(tx, context.resourceId);
    if (!participant.calendar_settled_at) throw new CommandError("invalid_input", { reason: "calendar_required" });
    const input = context.input;
    for (const commitment of input.commitments ?? []) {
      const interval = commitmentInterval(commitment, participant.timezone);
      if (!(interval.end > interval.start)) throw new CommandError("invalid_input");
    }

    await tx`
      update app.group_participants set
        preferred_hours = ${input.preferredHours ? tx.json(input.preferredHours) : tx`preferred_hours`},
        usual_place = ${input.usualPlace !== undefined ? input.usualPlace : tx`usual_place`},
        travel_mode = ${input.travelMode !== undefined ? input.travelMode : tx`travel_mode`},
        commitments = ${input.commitments ? tx.json(input.commitments as Parameters<typeof tx.json>[0]) : tx`commitments`},
        answered_at = coalesce(answered_at, now()), updated_at = now()
      where request_id = ${context.resourceId}
    `;
    return { step: "review" };
  },
};

// ---------------------------------------------------------------------------
// The review and its confirmation

// One listed time with its place, which only the stored record keeps.
export type ListedTime = GroupUnavailableTime & { readonly place: string | null; readonly startAt: number; readonly endAt: number };

export type GroupReviewDependencies = {
  readonly tokenKeys: readonly TokenKey[];
  readonly requesterCalendar: GoogleCalendarConfig;
};

export function groupReviewDependenciesFromEnvironment(tokenKeys: readonly TokenKey[]): GroupReviewDependencies {
  return { requesterCalendar: requesterCalendarConfigFromEnvironment(), tokenKeys };
}

// The group's range as instants: from the start of its first local date to
// the start of the day after its last, in the group's timezone.
export function groupRange(group: Pick<GroupRow, "range_start" | "range_end" | "timezone">) {
  return {
    end: new Date(startOfLocalDay(addDays(group.range_end, 1), group.timezone)),
    start: new Date(startOfLocalDay(group.range_start, group.timezone)),
  };
}

function listedSpan(start: number, end: number, allDay: boolean, timezone: string) {
  return allDay
    ? { end: localDate(new Date(end), timezone), start: localDate(new Date(start), timezone) }
    : { end: new Date(end).toISOString(), start: new Date(start).toISOString() };
}

// The participant's unavailable times within the range: their calendar's busy
// times under the evaluation's busy rules, each with its event's place, and
// what they said, ordered by start. Nothing else of an event is kept: no
// title, attendee or description.
export function unavailableTimes(
  events: readonly CalendarEvent[],
  commitments: readonly Commitment[],
  options: { readonly range: { readonly start: Date; readonly end: Date }; readonly timezone: string; readonly selfEmail: string | null },
): ListedTime[] {
  const { range, timezone } = options;
  const busy = normalizeBusy(events, { endpointKey: (text) => text, selfEmail: options.selfEmail, timezone });
  const listed: ListedTime[] = [];
  for (const interval of busy) {
    if (interval.end <= range.start.getTime() || interval.start >= range.end.getTime()) continue;
    listed.push({
      ...listedSpan(interval.start, interval.end, interval.allDay, timezone),
      allDay: interval.allDay,
      endAt: interval.end,
      place: interval.endpoint.kind === "place" ? interval.endpoint.text.slice(0, 500) : null,
      source: "calendar",
      startAt: interval.start,
    });
  }
  for (const commitment of commitments) {
    const interval = commitmentInterval(commitment, timezone);
    listed.push({
      ...listedSpan(interval.start, interval.end, commitment.allDay, timezone),
      allDay: commitment.allDay,
      endAt: interval.end,
      place: null,
      source: "stated",
      startAt: interval.start,
    });
  }
  return listed.sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt);
}

// Only the request's own Calendar grant is read.
async function listTimes(q: Queryable, deps: GroupReviewDependencies, group: GroupRow, participant: ParticipantRow): Promise<ListedTime[]> {
  const range = groupRange(group);
  const grant = await readRequesterCalendarGrant(q, deps.tokenKeys, participant.request_id);
  if (!grant) throw new CommandError("invalid_input", { reason: "calendar_required" });
  const events = await readRequesterEvents(deps.requesterCalendar, grant, range);
  return unavailableTimes(events, participant.commitments, { range, selfEmail: grant.email, timezone: participant.timezone });
}

export function fingerprintOf(times: readonly ListedTime[]) {
  return createHash("sha256")
    .update(canonicalJson(times.map(({ allDay, endAt, place, source, startAt }) => ({ allDay, endAt, place, source, startAt }))), "utf8")
    .digest("hex");
}

export async function readGroupReview(q: Queryable, deps: GroupReviewDependencies, requestId: string): Promise<GroupReview | null> {
  const group = await groupOfRequest(q, requestId);
  const participant = group ? await readParticipant(q, requestId) : null;
  if (!group || !participant || participantStep(participant) !== "review") return null;
  const times = await listTimes(q, deps, group, participant);
  return {
    fingerprint: fingerprintOf(times),
    times: times.map(({ allDay, end, source, start }) => ({ allDay, end, source, start })),
  };
}

export const confirmGroupReviewInput = z.object({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

// request.group.confirm: **These are right** on the review. The list is read
// again and must be the one shown (its fingerprint), so what is stored is what
// the participant confirmed; a changed list answers conflict and the card
// shows the new one. The last participant to be done closes the group.
export function confirmGroupReviewCommand(deps: GroupReviewDependencies): CommandDefinition<z.infer<typeof confirmGroupReviewInput>, { readonly done: true; readonly closed: boolean }> {
  return {
    input: confirmGroupReviewInput,
    operation: "request.group.confirm",
    async run(tx, context) {
      if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) throw new CommandError("forbidden");
      const { group, participant } = await lockAnswering(tx, context.resourceId);
      if (participantStep(participant) !== "review") throw new CommandError("invalid_input");

      const times = await listTimes(tx, deps, group, participant);
      if (fingerprintOf(times) !== context.input.fingerprint) throw new CommandError("stale_revision", { reason: "group_review_changed" });
      if ((await doneCount(tx, group.id)) >= group.participant_limit) throw new CommandError("request_closed");

      for (const time of times) {
        await tx`
          insert into app.group_unavailable_times (request_id, source, starts_at, ends_at, all_day, place)
          values (${participant.request_id}, ${time.source}, ${new Date(time.startAt)}, ${new Date(time.endAt)}, ${time.allDay}, ${time.place})
        `;
      }
      await tx`update app.group_participants set done_at = now(), updated_at = now() where request_id = ${participant.request_id}`;

      const full = (await doneCount(tx, group.id)) >= group.participant_limit;
      return { closed: full ? await closeGroup(tx, group.id) : false, done: true };
    },
  };
}
