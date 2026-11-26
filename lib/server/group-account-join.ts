import { createHash } from "node:crypto";
import { z } from "zod";
import { type ConfirmedSettings, SETUP_FIELD_SCHEMAS, type WeeklyWindow } from "../contracts/setup";
import type { SlotPreview } from "../contracts/slot-preview";
import { type ChannelLanguage, hostConversationLanguage, textLanguage } from "./channel-language";
import { linkedMessagingTurn } from "./channel-selection";
import { TRAVEL_MODE_TEXTS, weeklyHoursText, weekText } from "./channel-texts";
import { canonicalJson, CommandError } from "./commands";
import type { Transaction } from "./database";
import { emailSourceHash } from "./email-receipts";
import { hostPlaces } from "./evaluation";
import { addDays, type BusyInterval, hostPreviewIntervals, localParts, normalizeBusy, startOfLocalDay } from "./feasibility";
import { CalendarAccessError, openHostCalendar } from "./google-calendar";
import type { GroupToolDependencies } from "./group-host-tools";
import { closeGroup, doneCount, findGroupByToken, type GroupRow, isGroupToken, readGroup } from "./group-meetings";
import { type Commitment, commitmentSchema, fingerprintOf, groupRange, type ListedTime, unavailableTimes } from "./group-participants";
import { activeBindingOfHost, bindingRecipient } from "./imessage-links";
import { recordOutbound } from "./imessage-outbox";
import { admitCreation, CREATION_LIMITS, identifyDraft, insertDraftRequest } from "./request-start";
import { lockOpenRequest } from "./request-guard";
import { authorizeSetupTool, SettingsChannelOnlyError, type SetupToolCall } from "./setup-tools";

// A host who already uses the service joins another host's group meeting from
// their own linked conversation (group-scheduling): they send the group link
// there instead of opening it. Nothing is asked that their settings already
// answer. Their usual place, travel mode and meeting hours come from their
// confirmed settings, their busy time from their conflict calendars, and the
// service sends their open times in the group's range as the slot image with
// one question: "as usual, is that right?". A yes confirms exactly what the
// picture showed (its fingerprint); a correction in words (a fixed commitment
// missing from the calendar, other hours, another place or travel mode) sends
// a new picture. Only on the yes is a participant request created, already
// identified and done, with the unavailable times stored as the web review
// stores them, so the close and the booking treat it like any participant.

const GROUP_LINK = /(?:^|[\s/])g\/([A-Za-z0-9_-]{43})(?=$|[\s/?#.,!)])/;

// The group token in a message, or null.
export function groupTokenFromText(text: string) {
  const token = GROUP_LINK.exec(text.normalize("NFKC").trim())?.[1];
  return token && isGroupToken(token) ? token : null;
}

const travelModes = ["driving", "transit", "walking"] as const;

export const joinGroupToolInput = z
  .object({
    link: z.string().trim().min(1).max(500).describe("The group meeting link as the host sent it (findmeatime.com/g/…)."),
    commitments: z
      .array(commitmentSchema)
      .max(30)
      .default([])
      .describe("Fixed commitments the host named that their calendar does not show, the whole list so far: timed with ISO date-times and offsets, or allDay with local dates, end exclusive."),
    hours: SETUP_FIELD_SCHEMAS.weeklyWindows.optional().describe("Only when the host asked for other hours for this group than their usual meeting hours: the whole week."),
    usualPlace: z.string().trim().min(1).max(200).optional().describe("Only when the host named another place than usual for this group."),
    travelMode: z.enum(travelModes).optional().describe("Only when the host named another way of travelling than usual for this group."),
    confirm: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional()
      .describe("The fingerprint the last call returned, only when the host said yes to that picture and changed nothing."),
  })
  .strict();

type JoinInput = z.infer<typeof joinGroupToolInput>;

type Answers = {
  readonly hours: readonly WeeklyWindow[];
  readonly usualPlace: string | null;
  readonly travelMode: (typeof travelModes)[number] | null;
  readonly commitments: readonly Commitment[];
};

type Prepared = {
  readonly group: GroupRow;
  readonly settings: ConfirmedSettings;
  readonly email: string;
  readonly name: string;
  readonly answers: Answers;
  readonly times: readonly ListedTime[];
  readonly open: readonly { readonly start: number; readonly end: number }[];
  readonly fingerprint: string;
};

function answersOf(settings: ConfirmedSettings, input: JoinInput): Answers {
  const usualTravel = settings.travelMode && settings.travelMode !== "depends" ? settings.travelMode : null;
  return {
    commitments: input.commitments,
    hours: input.hours ?? settings.weeklyWindows,
    travelMode: input.travelMode ?? usualTravel,
    usualPlace: input.usualPlace ?? hostPlaces(settings)[0] ?? null,
  };
}

// The host's unavailable times in the group's range, as the web review lists
// them (calendar busy time with its place, and stated commitments), and the
// hours outside their meeting hours as stated time; and the open times left.
async function prepare(deps: GroupToolDependencies, me: string, group: GroupRow, settings: ConfirmedSettings, email: string, input: JoinInput) {
  const close = deps.close();
  const answers = answersOf(settings, input);
  const range = groupRange(group);
  const calendar = await openHostCalendar({ config: close.calendar, db: deps.db, tokenKeys: close.tokenKeys }, me);
  const events = [];
  for (const entry of settings.conflictCalendars) events.push(...(await calendar.listEvents(entry.id, range)));

  const listed = unavailableTimes(events, answers.commitments, { range, selfEmail: email, timezone: settings.timezone });
  const busy: BusyInterval[] = [
    ...normalizeBusy(events, { endpointKey: (text) => text, noteExclusions: settings.noteExclusions, selfEmail: email, timezone: settings.timezone }),
    ...listed.filter((time) => time.source === "stated").map((time) => ({
      allDay: time.allDay,
      end: time.endAt,
      endpoint: { kind: "unknown" as const, reason: "no_location" as const },
      meeting: false,
      start: time.startAt,
    })),
  ];
  const now = Date.now();
  const from = new Date(Math.max(range.start.getTime(), now));
  const open = from < range.end
    ? hostPreviewIntervals(
        { bufferAfterMinutes: 0, bufferBeforeMinutes: 0, scheduleOverrides: settings.scheduleOverrides, timezone: settings.timezone, weeklyWindows: answers.hours },
        busy,
        { end: range.end, start: from },
        group.duration_minutes,
      )
    : [];

  // Everything in the range that is not open is unavailable: the calendar's
  // busy times keep their places for the travel check, the rest is stated.
  const gaps: ListedTime[] = [];
  let cursor = range.start.getTime();
  for (const slot of [...open, { end: range.end.getTime(), start: range.end.getTime() }]) {
    if (slot.start > cursor) {
      gaps.push({ allDay: false, end: new Date(slot.start).toISOString(), endAt: slot.start, place: null, source: "stated", start: new Date(cursor).toISOString(), startAt: cursor });
    }
    cursor = Math.max(cursor, slot.end);
  }
  const times = [...listed.filter((time) => time.source === "calendar"), ...gaps].toSorted((a, b) => a.startAt - b.startAt || a.endAt - b.endAt);
  const fingerprint = createHash("sha256")
    .update(canonicalJson({ answers: { travelMode: answers.travelMode, usualPlace: answers.usualPlace }, times: fingerprintOf(times) }), "utf8")
    .digest("hex");
  return { answers, fingerprint, open, times };
}

// The open times, one slot image per week of the group's range.
function weekPreviews(group: GroupRow, prepared: Pick<Prepared, "answers" | "open" | "fingerprint">, timezone: string): SlotPreview[] {
  const clock = (instant: number) => {
    const minute = localParts(instant, timezone).minute;
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  };
  const firstWeekday = (new Date(`${group.range_start}T00:00:00Z`).getUTCDay() + 6) % 7;
  const previews: SlotPreview[] = [];
  for (let weekStart = addDays(group.range_start, -firstWeekday); weekStart <= group.range_end; weekStart = addDays(weekStart, 7)) {
    const days = (["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const).map((weekday, index) => {
      const date = addDays(weekStart, index);
      if (date < group.range_start || date > group.range_end) return { date, open: [], weekday };
      const start = startOfLocalDay(date, timezone);
      const end = startOfLocalDay(addDays(date, 1), timezone);
      return {
        date,
        open: prepared.open.flatMap((slot) => {
          const from = Math.max(start, slot.start);
          const until = Math.min(end, slot.end);
          return from < until ? [{ end: until === end ? "24:00" : clock(until), start: clock(from) }] : [];
        }),
        weekday,
      };
    });
    const ranges = days.flatMap((day) => day.open);
    previews.push({
      days,
      durationMinutes: group.duration_minutes,
      grid: {
        end: ranges.length ? ranges.reduce((a, b) => (a > b.end ? a : b.end), "00:00") : "20:00",
        start: ranges.length ? ranges.reduce((a, b) => (a < b.start ? a : b.start), "24:00") : "10:00",
      },
      group: true,
      meetingMode: prepared.answers.usualPlace ? "in_person" : "either",
      place: prepared.answers.usualPlace,
      reviewRef: prepared.fingerprint.slice(0, 12),
      timezone,
      travelMode: prepared.answers.travelMode,
      weekStart,
    });
  }
  return previews;
}

function question(language: ChannelLanguage, hostName: string, settings: ConfirmedSettings, answers: Answers, open: boolean) {
  const travel = answers.travelMode ? TRAVEL_MODE_TEXTS[language][answers.travelMode] : null;
  const hours = weeklyHoursText(answers.hours, language);
  const calendars = settings.conflictCalendars.map((calendar) => calendar.summary).join(", ");
  if (language === "ko") {
    const how = [answers.usualPlace ? `${answers.usualPlace} 기준` : null, travel ? `${travel}로` : null].filter(Boolean).join(", ");
    const said = answers.commitments.length > 0 ? ", 말씀하신 고정 일정은 빼고" : "";
    return open
      ? `${hostName}님 그룹 미팅이에요. 하던 대로 ${how ? `${how}, ` : ""}${hours} 중 캘린더(${calendars})가 비어 있는 시간으로 할게요${said}. 맞으시죠? 캘린더에 없는 고정 일정이 있으면 알려 주세요.`
      : `${hostName}님 그룹 미팅 기간에는 하던 대로(${hours}, 캘린더 ${calendars}) 비어 있는 시간이 없어요. 이대로 보낼까요, 아니면 시간을 바꿀까요?`;
  }
  const how = [answers.usualPlace ? `from ${answers.usualPlace}` : null, travel ? travel.toLowerCase() : null].filter(Boolean).join(", ");
  const said = answers.commitments.length > 0 ? ", leaving out the commitments you named" : "";
  return open
    ? `This is ${hostName}'s group meeting. As usual, I'll use your free time on ${calendars} within ${hours}${how ? `, ${how}` : ""}${said}. Is that right? Tell me any fixed commitment that isn't on your calendar.`
    : `With your usual hours (${hours}) and calendars (${calendars}), you have no open time in ${hostName}'s group meeting. Send it like this, or change your hours?`;
}

type JoinResult =
  | { readonly queued: true; readonly fingerprint: string; readonly note: string }
  | { readonly joined: true; readonly note: string }
  | { readonly joined: false; readonly problem: string };

// The host acting from their linked conversation, with the turn and binding
// the picture goes to, or null.
async function linkedTurn(deps: GroupToolDependencies, call: SetupToolCall) {
  let actor;
  try {
    actor = await authorizeSetupTool(deps.db, call.auth, call.sessionId, { allowReview: true });
  } catch (error) {
    if (error instanceof SettingsChannelOnlyError) return null;
    throw error;
  }
  const turn = await linkedMessagingTurn(deps.db, call.sessionId, actor.id);
  const binding = await activeBindingOfHost(deps.db, actor.id);
  return turn && binding?.channel === turn.channel ? { actor, binding, turn } : null;
}

async function joinedRequest(q: Transaction | GroupToolDependencies["db"], groupId: string, me: string) {
  const [row] = await q<{ request_id: string; done: boolean }[]>`
    select r.id as request_id, p.done_at is not null as done
    from app.requests r
    join app.group_participants p on p.request_id = r.id
    join app.requester_host_profiles h on h.request_id = r.id
    where r.group_meeting_id = ${groupId} and h.host_account_id = ${me}
  `;
  return row ?? null;
}

export async function joinGroupForTool(deps: GroupToolDependencies, call: SetupToolCall, input: JoinInput): Promise<JoinResult> {
  const linked = await linkedTurn(deps, call);
  if (!linked) return { joined: false, problem: "Joining a group meeting in words works only from the host's linked messenger. Elsewhere, they open the link." };
  const { actor, binding, turn } = linked;
  const me = actor.id;

  const token = groupTokenFromText(input.link);
  if (!token) return { joined: false, problem: "That is not a group meeting link. Ask the host for the link they were sent." };
  const group = await findGroupByToken(deps.db, token);
  if (!group) return { joined: false, problem: 'No group meeting is at that link. Tell the host neutrally: "I can\'t find a group meeting at that link."' };
  if (group.host_account_id === me) {
    return { joined: false, problem: "This is the host's own group meeting link. Say so: they send it to the people they want to meet, and they hear back once everyone is done." };
  }
  const joined = await joinedRequest(deps.db, group.id, me);
  if (joined?.done) return { joined: false, problem: "The host already answered this group meeting, and answers cannot change now. The invitation comes from Google by email once its host picks a time." };
  if (group.state !== "collecting" || (await doneCount(deps.db, group.id)) >= group.participant_limit) {
    return { joined: false, problem: "This group meeting is full or closed, so nothing was sent. Say so." };
  }

  const [account] = await deps.db<{ email: string; settings: ConfirmedSettings | null; display_name: string | null }[]>`
    select g.email, s.settings, a.display_name from app.host_accounts a
    join app.google_identities g on g.host_account_id = a.id
    left join app.host_settings s on s.host_account_id = a.id
    where a.id = ${me} and a.status = 'active'
  `;
  if (!account?.settings) {
    return { joined: false, problem: "The host has not saved their settings yet, so there is nothing usual to use. Ask them to open the link in the browser instead; nothing was sent." };
  }
  const settings = account.settings;
  const [hostRow] = await deps.db<{ name: string | null }[]>`
    select settings ->> 'displayName' as name from app.host_settings where host_account_id = ${group.host_account_id}
  `;
  const hostName = hostRow?.name?.trim() || "the host";

  let prepared;
  try {
    prepared = await prepare(deps, me, group, settings, account.email, input);
  } catch (error) {
    if (error instanceof CalendarAccessError) {
      return { joined: false, problem: "Google Calendar could not be read, so no free time was assumed and nothing was sent. Ask the host to try again in a moment, or to reconnect Google Calendar." };
    }
    throw error;
  }

  if (input.confirm && input.confirm === prepared.fingerprint) {
    return confirmJoin(deps, { email: account.email, me, name: settings.displayName.trim() || account.display_name?.trim() || account.email.split("@")[0]! }, group, settings, prepared);
  }

  const language = textLanguage(turn.message) ?? (await hostConversationLanguage(deps.db, me));
  const previews = weekPreviews(group, prepared, settings.timezone);
  const summary = question(language, hostName, settings, prepared.answers, prepared.open.length > 0);
  const keys = deps.close().tokenKeys;
  await deps.db.begin(async (tx) => {
    for (const [index, preview] of previews.entries()) {
      const last = index === previews.length - 1;
      await recordOutbound(tx, {
        bindingId: binding.id,
        dedupeKey: `group-join:${group.id}:${call.callId}:${index}`,
        hostAccountId: me,
        image: { language, preview, summary: last ? summary : `${index + 1}/${previews.length} · ${weekText(preview.weekStart, language)}` },
        inputId: turn.inputId,
        kind: "image",
        recipient: bindingRecipient(keys, binding),
        recipientHash: binding.sender_hash,
        reviewHash: prepared.fingerprint,
        tokenKey: keys[0]!,
      });
    }
  });
  return {
    fingerprint: prepared.fingerprint,
    note: [
      input.confirm ? "Their times changed since the last picture, so a new one was sent; nothing was sent to the group yet." : "",
      "The picture of their open times and the question are on their way and stand in for your reply; add nothing.",
      "When they say yes, call join_group_meeting again with the same link and answers and confirm set to this fingerprint.",
      "When they correct something (a fixed commitment not on their calendar, other hours, another place or travel mode), call it again with the whole corrected answers and no confirm.",
      "Never ask which hours suit them.",
    ].filter(Boolean).join(" "),
    queued: true,
  };
}

async function confirmJoin(
  deps: GroupToolDependencies,
  account: { readonly me: string; readonly email: string; readonly name: string },
  group: GroupRow,
  settings: ConfirmedSettings,
  prepared: Awaited<ReturnType<typeof prepare>>,
): Promise<JoinResult> {
  const tokenKey = deps.tokenKey();
  try {
    await deps.db.begin(async (tx) => {
      const locked = await readGroup(tx, group.id, { lock: true });
      if (!locked || locked.state !== "collecting" || (await doneCount(tx, group.id)) >= locked.participant_limit) throw new CommandError("request_closed");
      if (await joinedRequest(tx, group.id, account.me)) throw new CommandError("stale_revision");

      await admitCreation(tx, emailSourceHash(tokenKey, account.email), CREATION_LIMITS);
      const language = await hostConversationLanguage(tx, account.me);
      const requestId = await insertDraftRequest(tx, {
        group: {
          durationMinutes: locked.duration_minutes,
          id: locked.id,
          purpose: locked.purpose,
          rangeEnd: locked.range_end,
          rangeStart: locked.range_start,
          timezone: locked.timezone,
        },
        hostAccountId: locked.host_account_id,
        language,
        sourceHash: emailSourceHash(tokenKey, account.email),
        timezone: settings.timezone,
        tokenKey,
      });
      await identifyDraft(
        tx,
        await lockOpenRequest(tx, requestId),
        { accountVerifiedEmail: true, email: account.email, language, name: account.name, timezone: settings.timezone },
        { origin: deps.origin(), tokenKey },
      );
      await tx`
        insert into app.requester_host_profiles (request_id, host_account_id, items, created_at, decided_at)
        values (${requestId}, ${account.me}, ${["calendars"]}, now(), now())
      `;
      await tx`update app.requests set calendar_settled_at = now() where id = ${requestId}`;
      for (const time of prepared.times) {
        await tx`
          insert into app.group_unavailable_times (request_id, source, starts_at, ends_at, all_day, place)
          values (${requestId}, ${time.source}, ${new Date(time.startAt)}, ${new Date(time.endAt)}, ${time.allDay}, ${time.place})
        `;
      }
      await tx`
        update app.group_participants
        set usual_place = ${prepared.answers.usualPlace}, travel_mode = ${prepared.answers.travelMode},
            commitments = ${tx.json(prepared.answers.commitments as Parameters<typeof tx.json>[0])},
            answered_at = now(), done_at = now(), updated_at = now()
        where request_id = ${requestId}
      `;
      if ((await doneCount(tx, locked.id)) >= locked.participant_limit) await closeGroup(tx, locked.id);
    });
    return {
      joined: true,
      note: "Their open times were sent to the group meeting's host; only that they cannot meet at other times is shared, never what or where. Say so in one line, and that the invitation comes from Google by email once that host picks a time.",
    };
  } catch (error) {
    if (error instanceof CommandError) {
      if (error.category === "request_closed") return { joined: false, problem: "The group meeting filled up or closed just now, so nothing was sent. Say so." };
      if (error.category === "stale_revision") return { joined: false, problem: "The host already answered this group meeting." };
      if (error.category === "rate_limited") return { joined: false, problem: "Too many requests were started just now; nothing was sent. Ask them to try again later." };
      if (error.category === "forbidden") return { joined: false, problem: "This group meeting is not taking answers now; nothing was sent." };
    }
    throw error;
  }
}
