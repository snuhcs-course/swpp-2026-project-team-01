import type { ConfirmedSettings } from "../contracts/setup";
import { buildEventPayload, eventIdFor } from "./calendar-events";
import { type ChannelLanguage, hostConversationLanguage } from "./channel-language";
import { locale } from "./channel-texts";
import { database, type Database, type Transaction } from "./database";
import { type BusyInterval, evaluateFeasibility, legQueryKey, normalizeBusy, travelQueries } from "./feasibility";
import { type CalendarEvent, type CreatedEvent, type GoogleCalendarConfig, googleCalendarConfigFromEnvironment, openHostCalendar } from "./google-calendar";
import { type GroupRow, readGroup } from "./group-meetings";
import { findGroupOptions, type GroupOption, type GroupSearch, OPTIONS_SHOWN, type PlaceRef } from "./group-options";
import { groupRange } from "./group-participants";
import { hostPlaces, hostRulesOf } from "./evaluation";
import { activeBindingOfHost, bindingRecipient } from "./imessage-links";
import { recordOutbound } from "./imessage-outbox";
import type { JobHandler } from "./jobs";
import { placeBetween, type PlaceLookupConfig, placeLookupConfigFromEnvironment } from "./place-lookup";
import { closeRequest } from "./request-lifecycle";
import { endpointHasher, estimateTravel, type RoutesConfig, routesConfigFromEnvironment } from "./routes-client";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// A closed group meeting (group-scheduling design 5 and 6). The group_close job
// reads the host's conflict calendars, finds the options over the host and the
// done participants' confirmed times (group-options.ts), keeps them in
// group_meeting_options and sends the host's linked conversation one message
// with the first OPTIONS_SHOWN. The host asks for more, or names one; naming
// one reads the host's calendars again for it (never a participant's), books
// one event in the host's booking destination with every done participant as
// an attendee (Google sends the invitations) and closes the participant
// requests as booked. The event ID is derived from the group's ID, so a
// repeated choice cannot make a second event.

export type GroupCloseDependencies = {
  readonly db: Database;
  readonly tokenKeys: readonly TokenKey[];
  readonly calendar: GoogleCalendarConfig;
  readonly routes: RoutesConfig;
  readonly places: PlaceLookupConfig;
  readonly now?: () => number;
};

export function groupCloseDependenciesFromEnvironment(): GroupCloseDependencies {
  return {
    calendar: googleCalendarConfigFromEnvironment(),
    db: database(),
    places: placeLookupConfigFromEnvironment(),
    routes: routesConfigFromEnvironment(),
    tokenKeys: [tokenKeyFromEnvironment()],
  };
}

type HostContext = {
  readonly settings: ConfirmedSettings;
  readonly hostEmail: string | null;
};

async function hostContext(tx: Transaction, hostAccountId: string): Promise<HostContext | null> {
  const [row] = await tx<{ host_email: string | null; settings: ConfirmedSettings | null }[]>`
    select s.settings, (select email from app.google_identities g where g.host_account_id = a.id) as host_email
    from app.host_accounts a left join app.host_settings s on s.host_account_id = a.id
    where a.id = ${hostAccountId} and a.status = 'active'
  `;
  return row?.settings ? { hostEmail: row.host_email, settings: row.settings } : null;
}

// The search's host half: their rules, busy time over the range, bookings and
// whether Meet can be created. Participants are added by the caller.
async function hostSearch(tx: Transaction, deps: GroupCloseDependencies, group: GroupRow, host: HostContext): Promise<Omit<GroupSearch, "participants">> {
  const hash = endpointHasher(deps.tokenKeys[0]!);
  const range = groupRange(group);
  const calendar = await openHostCalendar({ config: deps.calendar, db: tx, tokenKeys: deps.tokenKeys }, group.host_account_id);
  const events: CalendarEvent[] = [];
  for (const entry of host.settings.conflictCalendars) events.push(...(await calendar.listEvents(entry.id, range)));
  let meetAvailable = false;
  try {
    meetAvailable = (await calendar.conferenceSolutionTypes(host.settings.bookingCalendar.id)).includes("hangoutsMeet");
  } catch {
    meetAvailable = false;
  }
  const bookings = await tx<{ event_id: string; start_at: Date }[]>`
    select event_id, start_at from app.bookings
    where host_account_id = ${group.host_account_id} and state in ('reserved', 'dispatching', 'confirmed')
      and end_at > ${range.start} and start_at < ${range.end}
  `;
  const now = new Date((deps.now ?? Date.now)());
  return {
    bookedStarts: bookings.map((row) => row.start_at.getTime()),
    durationMinutes: group.duration_minutes,
    host: hostRulesOf(host.settings, hash),
    hostBusy: normalizeBusy(events, {
      bookedEventIds: new Set(bookings.map((row) => row.event_id)),
      endpointKey: hash,
      noteExclusions: host.settings.noteExclusions,
      selfEmail: host.hostEmail,
      timezone: host.settings.timezone,
    }),
    hostPlaces: hostPlaces(host.settings).map((text): PlaceRef => ({ key: hash(text), text })),
    meetAvailable,
    now,
    range: { end: range.end, start: new Date(Math.max(range.start.getTime(), now.getTime())) },
    timezone: group.timezone,
  };
}

type ParticipantRecord = {
  readonly request_id: string;
  readonly name: string;
  readonly email: string;
  readonly timezone: string | null;
  readonly usual_place: string | null;
  readonly travel_mode: "driving" | "transit" | "walking" | null;
  readonly preferred_hours: readonly { readonly start: string; readonly end: string }[];
};

async function doneParticipants(tx: Transaction, groupId: string) {
  return tx<ParticipantRecord[]>`
    select p.request_id, r.requester_name as name, r.contact_email as email, r.details ->> 'timezone' as timezone,
           p.usual_place, p.travel_mode, p.preferred_hours
    from app.group_participants p join app.requests r on r.id = p.request_id
    where r.group_meeting_id = ${groupId} and p.done_at is not null
    order by p.done_at
  `;
}

// A participant's confirmed unavailable times as the engine's busy time: a
// calendar event's stored place anchors their trips; a time without one is
// taken to be at their usual place.
async function participantBusy(tx: Transaction, requestId: string, hash: (text: string) => string): Promise<BusyInterval[]> {
  const rows = await tx<{ all_day: boolean; ends_at: Date; place: string | null; starts_at: Date }[]>`
    select starts_at, ends_at, all_day, place from app.group_unavailable_times where request_id = ${requestId} order by starts_at
  `;
  return rows.map((row) => ({
    allDay: row.all_day,
    end: row.ends_at.getTime(),
    endpoint: row.place ? { key: hash(row.place), kind: "place" as const, text: row.place } : { kind: "unknown" as const, reason: "no_location" as const },
    meeting: false,
    start: row.starts_at.getTime(),
  }));
}

function estimator(deps: GroupCloseDependencies, now: Date) {
  return (queries: Parameters<typeof estimateTravel>[1]) => estimateTravel({ config: deps.routes, db: deps.db }, queries, { now });
}

export async function computeGroupOptions(tx: Transaction, deps: GroupCloseDependencies, group: GroupRow): Promise<GroupOption[]> {
  const host = await hostContext(tx, group.host_account_id);
  if (!host) return [];
  const hash = endpointHasher(deps.tokenKeys[0]!);
  const base = await hostSearch(tx, deps, group, host);
  const participants = [];
  for (const row of await doneParticipants(tx, group.id)) {
    participants.push({
      busy: await participantBusy(tx, row.request_id, hash),
      preferredHours: row.preferred_hours,
      requestId: row.request_id,
      timezone: row.timezone ?? group.timezone,
      travelMode: row.travel_mode,
      usualPlace: row.usual_place ? { key: hash(row.usual_place), text: row.usual_place } : null,
    });
  }
  return findGroupOptions(
    { ...base, participants },
    { between: (places) => placeBetween(deps.places, places), estimate: estimator(deps, base.now), hash },
  );
}

// ---------------------------------------------------------------------------
// The host's messages

export type StoredOption = {
  readonly position: number;
  readonly mode: "in_person" | "online";
  readonly place: string | null;
  readonly start: Date;
  readonly end: Date;
  readonly missing: readonly string[];
};

export async function readOptions(q: Transaction | Database, groupId: string): Promise<StoredOption[]> {
  const rows = await q<{ ends_at: Date; missing: string[] | null; mode: "in_person" | "online"; place: string | null; position: number; starts_at: Date }[]>`
    select o.position, o.mode, o.place, o.starts_at, o.ends_at,
           (select array_agg(r.requester_name order by r.requester_name) from app.requests r where r.id = any(o.missing_request_ids)) as missing
    from app.group_meeting_options o where o.group_meeting_id = ${groupId} order by o.position
  `;
  return rows.map((row) => ({ end: row.ends_at, missing: row.missing ?? [], mode: row.mode, place: row.place, position: row.position, start: row.starts_at }));
}

function optionTime(option: Pick<StoredOption, "start" | "end">, zone: string, language: ChannelLanguage) {
  const tag = locale(language);
  const day = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: zone, weekday: "short" }).format(option.start);
  const clock = new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${day} ${clock.format(option.start)}–${clock.format(option.end)}`;
}

export function optionLine(option: StoredOption, zone: string, language: ChannelLanguage) {
  const where = option.mode === "online" ? (language === "ko" ? "온라인 (Google Meet)" : "Online (Google Meet)") : option.place!;
  const missing = option.missing.length === 0 ? "" : language === "ko" ? ` — ${option.missing.join(", ")}님 불가` : ` — ${option.missing.join(", ")} can't make it`;
  return `${option.position}. ${optionTime(option, zone, language)} · ${where}${missing}`;
}

export function closeNoticeText(
  group: Pick<GroupRow, "purpose" | "timezone">,
  done: number,
  options: readonly StoredOption[],
  language: ChannelLanguage,
) {
  const shown = options.slice(0, OPTIONS_SHOWN);
  const everyone = shown.length > 0 && shown.every((option) => option.missing.length === 0);
  if (language === "ko") {
    const head = `"${group.purpose}" 그룹 일정: ${done}명이 답했어요.`;
    if (shown.length === 0) return `${head}\n범위 안에서 가능한 시간을 찾지 못했어요.`;
    return [
      head,
      everyone ? "모두 가능한 시간이에요:" : "모두 되는 시간은 없어서, 가장 많은 사람이 되는 시간이에요:",
      ...shown.map((option) => optionLine(option, group.timezone, language)),
      `번호로 하나 골라 주세요.${options.length > shown.length ? " 다른 시간이 더 필요하면 말해 주세요." : ""}`,
    ].join("\n");
  }
  const head = `"${group.purpose}" group meeting: ${done} ${done === 1 ? "person has" : "people have"} answered.`;
  if (shown.length === 0) return `${head}\nI could not find a time in the range.`;
  return [
    head,
    everyone ? "Times that work for everyone:" : "No time works for everyone. These work for the most people:",
    ...shown.map((option) => optionLine(option, group.timezone, language)),
    `Reply with a number to book it.${options.length > shown.length ? " Ask if you'd like more times." : ""}`,
  ].join("\n");
}

async function sendHostMessage(tx: Transaction, deps: GroupCloseDependencies, group: GroupRow, text: string, dedupeKey: string) {
  const binding = await activeBindingOfHost(tx, group.host_account_id);
  if (!binding) return false;
  await recordOutbound(tx, {
    bindingId: binding.id,
    dedupeKey,
    hostAccountId: group.host_account_id,
    kind: "notice",
    recipient: bindingRecipient(deps.tokenKeys, binding),
    recipientHash: binding.sender_hash,
    text,
    tokenKey: deps.tokenKeys[0]!,
  });
  return true;
}

// The group_close job: the options, once, and the host's message.
export function createGroupCloseHandler(load: () => GroupCloseDependencies = groupCloseDependenciesFromEnvironment): JobHandler {
  return async (tx, job) => {
    const groupId = typeof job.payload.groupId === "string" ? job.payload.groupId : null;
    const group = groupId ? await readGroup(tx, groupId, { lock: true }) : null;
    if (!group || group.state !== "closed") return { sent: false };
    const deps = load();

    const options = await computeGroupOptions(tx, deps, group);
    await tx`delete from app.group_meeting_options where group_meeting_id = ${group.id}`;
    for (const [index, option] of options.entries()) {
      await tx`
        insert into app.group_meeting_options (group_meeting_id, position, mode, place, starts_at, ends_at, missing_request_ids)
        values (${group.id}, ${index + 1}, ${option.mode}, ${option.place}, ${option.start}, ${option.end}, ${option.missing as string[]})
      `;
    }
    const stored = await readOptions(tx, group.id);
    await tx`update app.group_meetings set notice_shown = ${Math.min(OPTIONS_SHOWN, stored.length)}, updated_at = now() where id = ${group.id}`;

    const done = (await doneParticipants(tx, group.id)).length;
    const language = await hostConversationLanguage(tx, group.host_account_id);
    return { sent: await sendHostMessage(tx, deps, group, closeNoticeText(group, done, stored, language), `group-close:${group.id}`) };
  };
}

// ---------------------------------------------------------------------------
// More options, and the host's choice

// The next OPTIONS_SHOWN options after those shown, for the host's request in
// words; it remembers how far the host has seen.
export async function showMoreOptions(tx: Transaction, group: GroupRow) {
  const options = await readOptions(tx, group.id);
  const next = options.slice(group.notice_shown, group.notice_shown + OPTIONS_SHOWN);
  await tx`update app.group_meetings set notice_shown = ${group.notice_shown + next.length}, updated_at = now() where id = ${group.id}`;
  return { options: next, remaining: Math.max(0, options.length - group.notice_shown - next.length) };
}

export type ChoiceOutcome =
  | { readonly booked: true; readonly option: StoredOption; readonly attendees: number; readonly already: boolean }
  | { readonly booked: false; readonly problem: "no_such_option" | "not_closed" | "host_busy" | "host_unavailable" | "calendar_rejected" | "calendar_uncertain" };

// Whether the host still fits the option: the engine over exactly its time and
// place, for the host alone, with fresh calendar reads.
async function hostStillFits(tx: Transaction, deps: GroupCloseDependencies, group: GroupRow, host: HostContext, option: StoredOption) {
  const base = await hostSearch(tx, deps, group, host);
  const hash = endpointHasher(deps.tokenKeys[0]!);
  const place = option.place ? { key: hash(option.place), text: option.place } : null;
  const input = {
    allowances: [],
    bookedStarts: base.bookedStarts,
    host: base.host,
    hostBusy: base.hostBusy,
    meetAvailable: base.meetAvailable,
    now: base.now,
    request: {
      durationMinutes: group.duration_minutes,
      linkPlan: option.mode === "online" ? { kind: "google_meet" as const } : null,
      location: place,
      mode: option.mode,
      timezone: group.timezone,
      travelMode: null,
      windows: [{ end: option.end, start: option.start }],
    },
    requesterBusy: null,
  };
  const estimates = await estimator(deps, base.now)(travelQueries(input));
  const result = evaluateFeasibility({ ...input, estimate: (query) => estimates.get(legQueryKey(query)) });
  return result.candidates.some((candidate) => Date.parse(candidate.start) === option.start.getTime());
}

export async function chooseGroupOption(tx: Transaction, deps: GroupCloseDependencies, group: GroupRow, position: number): Promise<ChoiceOutcome> {
  const option = (await readOptions(tx, group.id)).find((entry) => entry.position === position);
  if (group.state === "booked") {
    const booked = (await readOptions(tx, group.id)).find((entry) => entry.position === group.chosen_position);
    return booked ? { already: true, attendees: (await doneParticipants(tx, group.id)).length, booked: true, option: booked } : { booked: false, problem: "not_closed" };
  }
  if (group.state !== "closed" && !(group.state === "booking" && group.chosen_position === position)) return { booked: false, problem: "not_closed" };
  if (!option) return { booked: false, problem: "no_such_option" };

  const host = await hostContext(tx, group.host_account_id);
  if (!host) return { booked: false, problem: "host_unavailable" };
  if (!(await hostStillFits(tx, deps, group, host, option))) return { booked: false, problem: "host_busy" };

  const participants = await doneParticipants(tx, group.id);
  const [first, ...rest] = participants.map((row) => ({ email: row.email, name: row.name }));
  if (!first) return { booked: false, problem: "not_closed" };

  await tx`
    update app.group_meetings set state = 'booking', chosen_position = ${position}, calendar_id = ${host.settings.bookingCalendar.id},
           event_id = ${eventIdFor(group.id)}, updated_at = now()
    where id = ${group.id}
  `;
  const payload = buildEventPayload({
    attendees: [first, ...rest],
    bookingId: group.id,
    end: option.end.toISOString(),
    hostTimezone: host.settings.timezone,
    linkPlan: option.mode === "online" ? { kind: "google_meet" } : null,
    location: option.place,
    mode: option.mode,
    purpose: group.purpose,
    start: option.start.toISOString(),
  });
  const calendar = await openHostCalendar({ config: deps.calendar, db: tx, tokenKeys: deps.tokenKeys }, group.host_account_id);
  const written = await calendar.insertEvent(host.settings.bookingCalendar.id, payload);
  let event: CreatedEvent | null = null;
  if (written.outcome === "created") event = written.event;
  else if (written.outcome === "duplicate" || written.outcome === "uncertain") {
    const read = await calendar.getEvent(host.settings.bookingCalendar.id, eventIdFor(group.id));
    event = read.outcome === "found" ? read.event : null;
  }
  if (!event) {
    // Nothing was booked: the group goes back to waiting for a choice.
    await tx`update app.group_meetings set state = 'closed', chosen_position = null, calendar_id = null, event_id = null, updated_at = now() where id = ${group.id}`;
    return { booked: false, problem: written.outcome === "rejected" ? "calendar_rejected" : "calendar_uncertain" };
  }

  await tx`
    update app.group_meetings set state = 'booked', booked_at = now(),
           event_evidence = ${tx.json({ htmlLink: event.htmlLink, iCalUID: event.iCalUID, joinUrl: event.joinUrl, status: event.status })},
           updated_at = now()
    where id = ${group.id}
  `;
  for (const participant of participants) await closeRequest(tx, participant.request_id, "booked");
  return { already: false, attendees: participants.length, booked: true, option };
}
