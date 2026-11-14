import type { StoredChannel } from "../contracts/messaging-channel";
import type { RequestState } from "../contracts/request";
import type { MeetingMode, SetupFieldName, TravelMode, Weekday } from "../contracts/setup";
import type { HoursSuggestion, LocalRange, SlotPreview, SlotPreviewDay } from "../contracts/slot-preview";
import type { ChannelLanguage } from "./channel-language";

// The fixed replies of a linked conversation, in English and Korean
// (channel-actions-in-words D3, D4). None of them asks the host to type a
// command or a reference: each says what the host can tell Thyme instead, or
// points to the browser. The exact commands still work (D2); their replies are
// these texts too.

type Texts<T> = { readonly [L in ChannelLanguage]: T };

export function locale(language: ChannelLanguage) {
  return language === "ko" ? "ko-KR" : "en-US";
}

export const STATE_WORDS: Texts<Readonly<Record<RequestState, string>>> = {
  en: {
    awaiting_host_approval: "awaiting your approval",
    booked: "booked",
    booking: "booking",
    declined: "declined",
    draft: "draft",
    expired: "expired",
    gathering: "gathering details",
    negotiating: "finding a time",
    withdrawn: "withdrawn",
  },
  ko: {
    awaiting_host_approval: "승인 대기 중",
    booked: "예약됨",
    booking: "예약 중",
    declined: "거절됨",
    draft: "작성 중",
    expired: "만료됨",
    gathering: "정보 수집 중",
    negotiating: "시간 조율 중",
    withdrawn: "철회됨",
  },
};

export const FIELD_LABELS: Texts<Readonly<Record<SetupFieldName, string>>> = {
  en: {
    bufferAfterMinutes: "Buffer after",
    bufferBeforeMinutes: "Buffer before",
    displayName: "Name on your page",
    durationMinutes: "Meeting length",
    handle: "Booking link handle",
    location: "Where you meet",
    meetingMode: "Meeting mode",
    noteExclusions: "Excluded note entries",
    timezone: "Timezone",
    travelBufferMinutes: "Extra travel time",
    travelMode: "How you travel",
    weeklyLimit: "Weekly meeting limit",
    weeklyLimitCounts: "Counted toward the limit",
    weeklyWindows: "Meeting hours",
  },
  ko: {
    bufferAfterMinutes: "미팅 후 여유 시간",
    bufferBeforeMinutes: "미팅 전 여유 시간",
    displayName: "페이지에 표시할 이름",
    durationMinutes: "미팅 길이",
    handle: "예약 링크 핸들",
    location: "만나는 장소",
    meetingMode: "미팅 방식",
    noteExclusions: "제외한 메모 일정",
    timezone: "시간대",
    travelBufferMinutes: "추가 이동 시간",
    travelMode: "이동 수단",
    weeklyLimit: "주간 미팅 한도",
    weeklyLimitCounts: "한도에 세는 미팅",
    weeklyWindows: "미팅 가능 시간",
  },
};

const WEEKDAYS_KO: Readonly<Record<string, string>> = {
  friday: "금",
  monday: "월",
  saturday: "토",
  sunday: "일",
  thursday: "목",
  tuesday: "화",
  wednesday: "수",
};

export function weekdayShort(weekday: string, language: ChannelLanguage) {
  return language === "ko" ? (WEEKDAYS_KO[weekday] ?? weekday) : weekday.slice(0, 3);
}

// ---------------------------------------------------------------------------
// The chat onboarding's times, days and meeting details (host-onboarding-in-chat
// design 3 and 5), shared by the onboarding texts below and the slot image.

function clockMinutes(clock: string) {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

// A clock as a chat reads it: "9시", "9시 반", "22시"; "9am", "9:30am", "noon".
export function clockText(clock: string, language: ChannelLanguage) {
  const [hour, minute] = clock.split(":").map(Number);
  if (language === "ko") return `${hour}시${minute === 0 ? "" : minute === 30 ? " 반" : ` ${minute}분`}`;
  if (minute === 0 && hour % 12 === 0) return hour === 12 ? "noon" : "midnight";
  return `${hour % 12 || 12}${minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`}${hour % 24 < 12 ? "am" : "pm"}`;
}

// "9시~22시" or "9am–10pm"; an end at or before the start is on the next day.
export function rangeText(range: LocalRange, language: ChannelLanguage) {
  const nextDay = range.end !== "24:00" && clockMinutes(range.end) <= clockMinutes(range.start);
  return language === "ko"
    ? `${clockText(range.start, "ko")}~${nextDay ? "다음 날 " : ""}${clockText(range.end, "ko")}`
    : `${clockText(range.start, "en")}–${clockText(range.end, "en")}`;
}

// A Korean clock as it is said aloud, with the part of the day: "9시", "오후 5시", "저녁 10시".
function spokenKo(clock: string) {
  const [hour, minute] = clock.split(":").map(Number);
  const rest = minute === 0 ? "" : minute === 30 ? " 반" : ` ${minute}분`;
  if (hour % 24 === 0) return minute === 0 ? "자정" : `밤 12시${rest}`;
  if (hour < 6) return `새벽 ${hour}시${rest}`;
  if (hour < 12) return `${hour}시${rest}`;
  if (hour === 12) return `낮 12시${rest}`;
  if (hour < 18) return `오후 ${hour - 12}시${rest}`;
  if (hour < 23) return `저녁 ${hour - 12}시${rest}`;
  return `밤 ${hour - 12}시${rest}`;
}

// The Korean particle after a word: 으로 or 로, 을 or 를, by its last syllable.
function finalConsonant(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 ? code % 28 : 0;
}
const ro = (word: string) => `${word}${[0, 8].includes(finalConsonant(word)) ? "로" : "으로"}`;
const eul = (word: string) => `${word}${finalConsonant(word) === 0 ? "를" : "을"}`;

function listEn(items: readonly string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

// The hours of a suggestion by day group; a weekend whose two days match reads as one.
function hourGroups(hours: HoursSuggestion, language: ChannelLanguage) {
  const [first, second] = hours.weekend;
  const sameWeekend = second !== undefined && first.start === second.start && first.end === second.end;
  const weekendLabel = { en: { saturday: "Saturdays", sunday: "Sundays" }, ko: { saturday: "토요일", sunday: "일요일" } }[language];
  return [
    { label: language === "ko" ? "평일" : "weekdays", range: hours.weekdays },
    ...(sameWeekend
      ? [{ label: language === "ko" ? "주말" : "weekends", range: first }]
      : hours.weekend.map((day) => ({ label: weekendLabel[day.weekday], range: day }))),
  ];
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The dates of the week starting on a YYYY-MM-DD Monday: "11월 16일~22일", "Nov 16–22".
export function weekText(weekStart: string, language: ChannelLanguage) {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  if (language === "ko") {
    return `${start.getUTCMonth() + 1}월 ${start.getUTCDate()}일~${sameMonth ? "" : `${end.getUTCMonth() + 1}월 `}${end.getUTCDate()}일`;
  }
  return `${MONTHS_EN[start.getUTCMonth()]} ${start.getUTCDate()}–${sameMonth ? "" : `${MONTHS_EN[end.getUTCMonth()]} `}${end.getUTCDate()}`;
}

// "월" or "Mon".
export function dayShort(weekday: Weekday, language: ChannelLanguage) {
  return language === "ko" ? weekdayShort(weekday, "ko") : `${weekday[0].toUpperCase()}${weekday.slice(1, 3)}`;
}

export function durationText(minutes: number, language: ChannelLanguage) {
  if (language === "en") return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${minutes}분` : `${hours}시간${minutes % 60 === 0 ? "" : ` ${minutes % 60}분`}`;
}

export const MEETING_MODE_TEXTS: Texts<Readonly<Record<MeetingMode, string>>> = {
  en: { either: "In person or online", in_person: "In person", online: "Online" },
  ko: { either: "대면·온라인", in_person: "대면", online: "온라인" },
};

export const TRAVEL_MODE_TEXTS: Texts<Readonly<Record<TravelMode, string>>> = {
  en: { depends: "Travel varies", driving: "By car", transit: "By transit", walking: "On foot" },
  ko: { depends: "이동 수단은 그때그때", driving: "자동차", transit: "대중교통", walking: "도보" },
};

// "월~금", "월·화", "Mon–Fri", "Mon & Tue" for consecutive days.
function runLabel(run: readonly SlotPreviewDay[], language: ChannelLanguage) {
  const first = dayShort(run[0].weekday, language);
  const last = dayShort(run[run.length - 1].weekday, language);
  if (run.length === 1) return first;
  if (run.length === 2) return language === "ko" ? `${first}·${last}` : `${first} & ${last}`;
  return language === "ko" ? `${first}~${last}` : `${first}–${last}`;
}

// Consecutive days split wherever `same` says two neighbours differ; closed days split runs and are left out.
function dayRuns(days: readonly SlotPreviewDay[], same: (a: SlotPreviewDay, b: SlotPreviewDay) => boolean) {
  const runs: SlotPreviewDay[][] = [];
  let previous: SlotPreviewDay | null = null;
  for (const day of days) {
    if (day.open.length === 0) {
      previous = null;
      continue;
    }
    const run = runs.at(-1);
    if (previous && run && same(previous, day)) run.push(day);
    else runs.push([day]);
    previous = day;
  }
  return runs;
}

const SUMMARY_LIMIT = 80;

// The open ranges in one line, days with the same ranges together; when that runs
// long, the open days and their total hours instead.
function openSummary(preview: SlotPreview, language: ChannelLanguage) {
  const sameRanges = (a: SlotPreviewDay, b: SlotPreviewDay) =>
    a.open.length === b.open.length && a.open.every((range, i) => range.start === b.open[i].start && range.end === b.open[i].end);
  const ranges = (day: SlotPreviewDay) => day.open.map((range) => rangeText(range, language)).join(", ");
  const full = dayRuns(preview.days, sameRanges)
    .map((run) => `${runLabel(run, language)} ${ranges(run[0])}`)
    .join(" / ");
  if (full.length <= SUMMARY_LIMIT) return full;

  const days = dayRuns(preview.days, () => true)
    .map((run) => runLabel(run, language))
    .join(language === "ko" ? "·" : ", ");
  const minutes = preview.days
    .flatMap((day) => day.open)
    .reduce((sum, range) => {
      const length = (range.end === "24:00" ? 1440 : clockMinutes(range.end)) - clockMinutes(range.start);
      return sum + (length > 0 ? length : length + 1440);
    }, 0);
  const hours = Math.round(minutes / 60);
  return language === "ko" ? `${days}에 모두 약 ${hours}시간` : `${days}, about ${hours} hours in all`;
}

// The meeting the slots are for: "대면 30분, 역삼동 근처, 대중교통", "30 min, in person, …, by transit".
function meetingDetails(preview: SlotPreview, language: ChannelLanguage) {
  const mode = MEETING_MODE_TEXTS[language][preview.meetingMode];
  const travel = preview.travelMode ? TRAVEL_MODE_TEXTS[language][preview.travelMode] : null;
  const parts =
    language === "ko"
      ? [`${mode} ${durationText(preview.durationMinutes, "ko")}`, preview.place, travel]
      : [durationText(preview.durationMinutes, "en"), mode.toLowerCase(), preview.place, travel?.toLowerCase()];
  return parts.filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// The weekly note check's list (calendar-note-review design 10 and 11). Titles
// are calendar text the host or someone else wrote, so each is one line in
// quotes, read as data.

export type WeeklyNoteVerdict = "note" | "event" | "unsure";

export type WeeklyListEntry = {
  readonly number: number;
  readonly title: string;
  readonly start: string;
  readonly allDay: boolean;
  readonly verdict: WeeklyNoteVerdict | null;
};

const TITLE_LIMIT = 60;

// Control characters and line or paragraph separators become spaces.
function oneLine(text: string) {
  return Array.from(text, (character) => {
    const code = character.codePointAt(0)!;
    return code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 ? " " : character;
  }).join("");
}

export function quotedTitle(title: string) {
  const line = oneLine(title)
    .replace(/["\u201c\u201d]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return `"${(line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1)}…` : line) || "?"}"`;
}

const WEEKDAY_OF_SHORT: Readonly<Record<string, Weekday>> = {
  Fri: "friday", Mon: "monday", Sat: "saturday", Sun: "sunday", Thu: "thursday", Tue: "tuesday", Wed: "wednesday",
};

// "11월 18일(수) 종일", "11월 17일(화) 19:00", "Wed Nov 18, all day".
export function noteWhenText(start: string, allDay: boolean, timeZone: string, language: ChannelLanguage) {
  const at = allDay ? new Date(`${start.slice(0, 10)}T00:00:00Z`) : new Date(start);
  if (Number.isNaN(at.getTime())) return start;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      day: "numeric", hour: "2-digit", hourCycle: "h23", minute: "2-digit", month: "numeric", timeZone: allDay ? "UTC" : timeZone, weekday: "short",
    }).formatToParts(at).map((part) => [part.type, part.value]),
  );
  const weekday = WEEKDAY_OF_SHORT[parts.weekday ?? ""] ?? "monday";
  const month = Number(parts.month);
  const time = `${parts.hour}:${parts.minute}`;
  return language === "ko"
    ? `${month}월 ${parts.day}일(${dayShort(weekday, "ko")}) ${allDay ? "종일" : time}`
    : `${dayShort(weekday, "en")} ${MONTHS_EN[month - 1]} ${parts.day}, ${allDay ? "all day" : time}`;
}

function numbersText(numbers: readonly number[], language: ChannelLanguage) {
  return language === "ko" ? numbers.map((number) => `${number}번`).join(", ") : listEn(numbers.map(String));
}

const VERDICT_TEXTS: Texts<Readonly<Record<WeeklyNoteVerdict, string>>> = {
  en: { event: "looks like an event", note: "looks like a note", unsure: "not sure" },
  ko: { event: "일정으로 보여요", note: "메모로 보여요", unsure: "판단이 어려워요" },
};

function weeklyLines(entries: readonly WeeklyListEntry[], timeZone: string, language: ChannelLanguage) {
  return entries.map((entry) =>
    [`${entry.number}. ${quotedTitle(entry.title)}`, noteWhenText(entry.start, entry.allDay, timeZone, language), entry.verdict ? VERDICT_TEXTS[language][entry.verdict] : null]
      .filter(Boolean)
      .join(" · "),
  );
}

// The read-back before freeing by number (D8): "1번 "엄마 생일", 3번 "과제 마감"을 비울까요?".
export function noteReadBack(entries: readonly { readonly number: number; readonly title: string }[], language: ChannelLanguage) {
  if (language === "en") return `Free ${listEn(entries.map((entry) => `${entry.number} ${quotedTitle(entry.title)}`))}?`;
  const named = entries.map((entry) => `${entry.number}번 ${quotedTitle(entry.title)}`).join(", ");
  const last = entries.at(-1)?.title.trim() ?? "";
  return `${named}${finalConsonant(last) === 0 ? "를" : "을"} 비울까요?`;
}

const hasOpenTime = (preview: SlotPreview) => preview.days.some((day) => day.open.length > 0);

export const CHANNEL_REPLIES = {
  en: {
    help: (origin: string) =>
      [
        "I'm Thyme. Tell me what you need in your own words, for example:",
        '"What requests do I have?"',
        '"Show me the proposal" or "book it"',
        '"Decline it" or "make it 30 minutes"',
        '"Let\'s go back to my settings"',
        `To unlink this conversation, open ${origin}/app.`,
      ].join("\n"),
    telegramHelp: "You can also tap Approve, Decline or Show details under a proposal.",
    stop: {
      imessage: "Unlinked. You won't get iMessages from Find Me a Time.",
      telegram: "Unlinked. You won't get Telegram messages from Find Me a Time.",
      whatsapp: "Unlinked. You won't get WhatsApp messages from Find Me a Time.",
    } satisfies Record<StoredChannel, string>,
    callbackStale: "This proposal has changed. Here is the current one.",
    callbackNotLinked: "Not linked",
    request: (ref: string, name: string, purpose: string | null) => `Request ${ref} from ${name}${purpose ? `: ${purpose}` : ""}.`,
    proposal: (version: number, time: string, minutes: number, place: string) => `Proposal ${version}: ${time}, ${minutes} minutes, ${place}.`,
    online: "online",
    inPerson: (location: string | null) => `in person${location ? ` at ${location}` : ""}`,
    status: (state: string) => `Status: ${state}.`,
    decideInWords: 'To approve, tell me so, such as "book it". To decline, tell me to decline it.',
    decidePrompt: (ref: string) => `Decide on request ${ref}?`,
    buttons: { approve: "Approve", confirm: "Confirm settings", decline: "Decline", details: "Show details" },
    savePrompt: "Save these settings?",
    selectedRequest: "We're now talking about this request.",
    selectedSetup: "We're now talking about your setup.",
    onboarding: {
      rolesDefault: (calendar: string) =>
        `I'll check your primary calendar (${calendar}) for busy times and put bookings there. If another calendar should count too, just tell me. I'm looking over your recent and upcoming calendar now and will suggest meeting hours next.`,
      rolesNeeded: "Which calendars should I check for busy times, and which one should bookings go into? Just tell me their names.",
      hoursQuestion: (hours: HoursSuggestion) => {
        const groups = hourGroups(hours, "en");
        const proposed = listEn(groups.map((group) => `${group.label} ${rangeText(group.range, "en")}`));
        if (hours.source === "starter_default") {
          return `Your recent and upcoming calendar is fairly quiet, so I started from ${proposed}. Shall I keep that as your meeting hours, or do you have other times in mind?`;
        }
        const seen = listEn(groups.map((group) => `from ${clockText(group.range.start, "en")} to ${clockText(group.range.end, "en")} on ${group.label}`));
        return `Looking at your recent and upcoming calendar, your appointments usually run ${seen}. Shall I set your meeting hours to ${proposed}?`;
      },
      // The note review link (calendar-note-review design 8), between the place
      // answer and the slot image.
      noteReviewLink: (count: number, url: string) =>
        `${count === 1 ? "One entry looks" : `${count} entries look`} like just a note. Check the ones that can be free, and I'll send your open times after that: ${url}`,
      // Under the image sent after a day without the review (design 8).
      noteReviewLater: (url: string) => `I kept the entries that look like notes busy for now. You can still choose which ones can be free here: ${url}`,
      slotCaption: (preview: SlotPreview) =>
        hasOpenTime(preview)
          ? `Next week's open times (${weekText(preview.weekStart, "en")}): ${openSummary(preview, "en")} (${meetingDetails(preview, "en")}). Shall I open these for booking?`
          : `Next week (${weekText(preview.weekStart, "en")}) has no open time with these settings (${meetingDetails(preview, "en")}). Want to change your meeting hours?`,
    },
    notes: {
      weeklyList: (entries: readonly WeeklyListEntry[], total: number, timeZone: string, url: string) =>
        [
          `${total === 1 ? "One calendar entry" : `${total} calendar entries`} to check this week. If any is just a note that can be free, tell me its number (for example "free 1 and 3"); if one is a real event, say so ("2 is a real event").`,
          ...weeklyLines(entries, timeZone, "en"),
          total > entries.length ? `${total - entries.length} more on the page: ${url}` : `See them on a week: ${url}`,
        ].join("\n"),
      noList: (url: string) => `There is no list to answer right now. You can check your entries here: ${url}`,
      staleList: (url: string) => `That list is no longer the current one, so nothing changed. Answer with the numbers of the latest list, or check them here: ${url}`,
      outsideList: (numbers: readonly number[], count: number) =>
        `${listEn(numbers.map(String))} ${numbers.length === 1 ? "is" : "are"} not on the list, so nothing changed. Choose from 1 to ${count}.`,
      changed: (numbers: readonly number[], url: string) =>
        `${listEn(numbers.map(String))} changed after the list was sent, so nothing changed. Check ${numbers.length === 1 ? "it" : "them"} here: ${url}`,
      alreadyAnswered: (numbers: readonly number[]) => `You already answered ${listEn(numbers.map(String))}.`,
      calendarUnavailable: (url: string) => `I couldn't read Google Calendar just now, so nothing changed. Tell me again in a moment, or check here: ${url}`,
    },
    nextStep: {
      analyzing: "I'm looking at your calendars; I'll have suggestions shortly.",
      choose_calendars: "Choose which calendars to check and where bookings go. Tell me here, or open the link below.",
      confirm_settings: "Your settings are ready to review. Ask me to go through them.",
      connect_calendar: "Connect Google Calendar first; that happens in the browser.",
      ready: "You're set up. Ask me about your settings or requests, or tell me what to change.",
      review_suggestions: "Let's go through your suggested settings. Tell me what you prefer.",
    } as Readonly<Record<string, string>>,
    openRequests: "Your open requests:",
    requestLine: (ref: string, name: string, state: string) => `${ref}: ${name}, ${state}`,
    whichRequest: "Tell me which one you'd like to talk about.",
    noOpenRequests: "You have no open requests.",
    ambiguousRef: (origin: string) => `That reference matches more than one request. Open ${origin}/app.`,
    unknownRef: (origin: string) => `I don't recognize that reference. Ask me which requests you have, or open ${origin}/app.`,
    requestGoneHere: "That request isn't available any more. Ask me which requests you have.",
    openToSetUp: (origin: string) => `Open ${origin}/app to set up.`,
    closedNothingChanged: (state: string) => `This request is ${state}; nothing changed.`,
    proposalChanged: "This proposal has changed.",
    notCurrent: (current: string) => `That proposal is no longer current; the current one is ${current}. Ask me to show it.`,
    noProposal: "There's no proposal to decide yet.",
    approved: "Approved. I'm adding it to your calendar and will tell you when it's confirmed.",
    alreadyApproved: "That proposal is already approved; the booking is under way.",
    declined: "Declined. The requester will be told; nothing was booked.",
    cannotDecide: (current: string | null) =>
      current
        ? `That proposal can't be decided now; it may have changed or still need the requester's agreement. Ask me to show the current one (${current}).`
        : "That proposal can't be decided now. Ask me to show the current one.",
    requestClosed: "This request is closed; nothing changed.",
    bookingUnderWay: "A booking for this request is under way; check it in the app.",
    couldNotHere: (origin: string) => `I couldn't do that here. Open ${origin}/app to continue.`,
    noChanges: "There are no suggested changes for this request. Tell me what you'd like to change.",
    suggestedChanges: (ref: string, parts: string) => `Suggested changes ${ref}: ${parts}.`,
    shareOrDrop: "Tell me to send them to the requester, or to drop them.",
    chooseRequestFirst: "Tell me which request you mean first.",
    notCurrentChanges: (current: string) => `Those aren't the current suggestions; the current ones are ${current}. Ask me to show them.`,
    noChangesToAct: "There are no suggested changes to act on.",
    shared: "Shared. I'll check the new time and send it to the requester for agreement.",
    dropped: "Dropped those suggestions; nothing was shared.",
    change: {
      start: (at: string) => `start ${at}`,
      minutes: (n: number) => `${n} minutes`,
      online: "online",
      inPerson: "in person",
      at: (place: string) => `at ${place}`,
      googleMeet: "a Google Meet link",
      requesterLink: "a meeting link the requester gave",
    },
    reviewNotCurrent: (current: string) => `That review is no longer current; the current one is ${current}. Ask me to show it.`,
    calendarUnreadable: (origin: string) => `Google Calendar couldn't be read. Reconnect it at ${origin}/app, then try again.`,
    saved: (link: string) => `Saved. Your booking link is ${link}`,
    destinationGone: (origin: string) => `Bookings can't be added to that calendar any more. Choose another at ${origin}/app.`,
    settingsMoved: "Your settings changed meanwhile. Ask me to show the current ones.",
    couldNotSave: (origin: string) => `I couldn't save that here. Open ${origin}/app.`,
    settingsHeader: "Your settings for review:",
    calendarsChecked: (names: string) => `Calendars checked: ${names}`,
    bookingsGoTo: (name: string) => `Bookings go to: ${name}`,
    starterDefault: " (starter default)",
    suggested: " (suggested)",
    stillNeeded: (what: string, origin: string) => `Still needed: ${what}. Answer here, or open ${origin}/app.`,
    yourCalendars: "your calendars",
    saveInWords: "If these look right, tell me to save them.",
    reviewTooLong: (origin: string) => `Your settings review is too long for a message. Review and confirm it at ${origin}/app.`,
    minutes: (n: number) => `${n} minutes`,
    perWeek: (n: number) => `${n} a week`,
    none: "none",
    decidePerMeeting: "decide per meeting",
    tooLong: "That message is too long for Thyme. Please send a shorter one.",
    requestGone: "That request isn't available any more, so this went to your setup conversation. Tell me which request you'd like to talk about.",
    unlinked: {
      imessage: "This number isn't linked to a Find Me a Time host. Sign in at findmeatime.com/app and choose Connect iMessage.",
      telegram: "This Telegram account isn't linked to a Find Me a Time host. Sign in at findmeatime.com/app and choose Connect Telegram.",
      whatsapp: "This number isn't linked to a Find Me a Time host. Sign in at findmeatime.com/app and choose Connect WhatsApp.",
    } satisfies Record<StoredChannel, string>,
    textOnly: "I can read text messages only.",
    textOnlyTelegram: "I can read text messages only. Photos, stickers and voice messages don't reach Thyme.",
    guestClosed: "This request is closed, so messages here no longer reach Thyme.",
    guestSwitched: (host: string) => `Now talking about your request with ${host}.`,
    yourHost: "your host",
    hostSelected: "Now talking about your own Find Me a Time account as a host.",
    picker: (guests: readonly { readonly name: string; readonly ref: string }[], host: boolean) =>
      [
        "Which conversation is this message for?",
        ...guests.map((guest) => `- your request with ${guest.name} (${guest.ref})`),
        ...(host ? ["- your own account as a host"] : []),
        "Tell me which one, for example by the person's name, or say \"I'm the host\".",
      ].join("\n"),
    readyForApproval: "Ready for your approval.",
    followsDecline: (ref: string) => `It follows your decline of request ${ref}.`,
    followsExpired: (ref: string) => `It follows request ${ref}, which expired.`,
    newRequest: (summary: string) => `New request: ${summary} Tell me if you'd like to talk about it here.`,
    booked: (name: string, when: string) => `Booked with ${name}: ${when}. It's on your calendar.`,
    bookingFailed: (ref: string, when: string, link: string) => `The booking for request ${ref} (${when}) wasn't confirmed. Check it in Find Me a Time: ${link}`,
    bookingSlow: (ref: string, when: string, link: string) => `The booking for request ${ref} (${when}) is taking longer than usual to confirm. Check it in Find Me a Time: ${link}`,
  },
  ko: {
    help: (origin: string) =>
      [
        "Thyme이에요. 필요한 것을 편하게 말씀해 주세요. 예를 들면:",
        "\"들어온 요청 있어?\"",
        "\"제안 보여 줘\" 또는 \"예약해 줘\"",
        "\"거절해 줘\" 또는 \"30분으로 바꿔 줘\"",
        "\"설정 얘기로 돌아가자\"",
        `이 대화의 연결을 끊으려면 ${origin}/app 을 열어 주세요.`,
      ].join("\n"),
    telegramHelp: "제안 아래의 승인, 거절, 자세히 보기 버튼을 눌러도 돼요.",
    stop: {
      imessage: "연결을 끊었어요. 이제 Find Me a Time의 iMessage를 받지 않아요.",
      telegram: "연결을 끊었어요. 이제 Find Me a Time의 Telegram 메시지를 받지 않아요.",
      whatsapp: "연결을 끊었어요. 이제 Find Me a Time의 WhatsApp 메시지를 받지 않아요.",
    } satisfies Record<StoredChannel, string>,
    callbackStale: "제안이 바뀌었어요. 현재 제안을 보내 드릴게요.",
    callbackNotLinked: "연결되지 않음",
    request: (ref: string, name: string, purpose: string | null) => `${name}님의 요청 ${ref}${purpose ? `: ${purpose}` : ""}`,
    proposal: (version: number, time: string, minutes: number, place: string) => `제안 ${version}: ${time}, ${minutes}분, ${place}`,
    online: "온라인",
    inPerson: (location: string | null) => (location ? `대면 (${location})` : "대면"),
    status: (state: string) => `상태: ${state}`,
    decideInWords: "승인하시려면 \"예약해 줘\"처럼 말씀해 주세요. 거절하시려면 거절해 달라고 말씀해 주세요.",
    decidePrompt: (ref: string) => `요청 ${ref}을 결정할까요?`,
    buttons: { approve: "승인", confirm: "설정 저장", decline: "거절", details: "자세히 보기" },
    savePrompt: "이 설정을 저장할까요?",
    selectedRequest: "이제 이 요청에 대해 이야기해요.",
    selectedSetup: "이제 설정에 대해 이야기해요.",
    onboarding: {
      rolesDefault: (calendar: string) =>
        `기본 캘린더(${calendar})로 일정을 확인하고 예약도 여기에 넣을게요. 다른 캘린더도 같이 봐야 하면 말씀해 주세요. 지금 최근 일정과 예정된 일정을 살펴보고 있으니 곧 미팅 시간을 제안드릴게요.`,
      rolesNeeded: "어떤 캘린더로 일정을 확인하고, 예약은 어느 캘린더에 넣을까요? 캘린더 이름으로 말씀해 주세요.",
      hoursQuestion: (hours: HoursSuggestion) => {
        const groups = hourGroups(hours, "ko");
        const proposed = groups.map((group) => `${group.label} ${rangeText(group.range, "ko")}`).join(", ");
        if (hours.source === "starter_default") {
          return `캘린더에 일정이 많지 않아서 기본 시간인 ${eul(proposed)} 넣어봤어요. 미팅 가능 시간을 이대로 잡아둘까요, 아니면 원하시는 시간이 있으세요?`;
        }
        const seen = groups.map((group) => `${group.label}엔 ${spokenKo(group.range.start)}부터 ${spokenKo(group.range.end)}까지`).join(", ");
        return `캘린더를 보니 ${seen} 보통 약속이 있으시네요. 미팅 가능 시간을 ${ro(proposed)} 잡아둘까요?`;
      },
      noteReviewLink: (count: number, url: string) =>
        `메모처럼 보이는 일정이 ${count}개 있어요. 비워도 되는 일정을 골라주세요. 고르시면 가능한 시간을 보내드릴게요: ${url}`,
      noteReviewLater: (url: string) => `메모처럼 보이는 일정은 일단 바쁨으로 두었어요. 비워도 되는 일정은 나중에 여기서 고를 수 있어요: ${url}`,
      slotCaption: (preview: SlotPreview) =>
        hasOpenTime(preview)
          ? `다음 주(${weekText(preview.weekStart, "ko")}) 비어 있는 시간이에요: ${openSummary(preview, "ko")} (${meetingDetails(preview, "ko")}). 이 시간들로 예약을 열어둘까요?`
          : `다음 주(${weekText(preview.weekStart, "ko")})에는 이 설정으로 비어 있는 시간이 없어요 (${meetingDetails(preview, "ko")}). 미팅 가능 시간을 바꿔볼까요?`,
    },
    notes: {
      weeklyList: (entries: readonly WeeklyListEntry[], total: number, timeZone: string, url: string) =>
        [
          `이번 주 확인할 일정이 ${total}개 있어요. 메모라서 비워도 되는 일정은 번호로 알려주세요(예: "1, 3번 비워줘"). 진짜 일정이면 그렇다고 말씀해 주세요(예: "2번은 일정이야").`,
          ...weeklyLines(entries, timeZone, "ko"),
          total > entries.length ? `외 ${total - entries.length}개는 링크에서 확인해주세요: ${url}` : `한 주로 펼쳐 보려면: ${url}`,
        ].join("\n"),
      noList: (url: string) => `지금 답하실 목록이 없어요. 일정은 여기서 확인할 수 있어요: ${url}`,
      staleList: (url: string) => `그 목록은 지난 목록이라 바꾼 건 없어요. 최신 목록의 번호로 알려주시거나 여기서 확인해주세요: ${url}`,
      outsideList: (numbers: readonly number[], count: number) => `${numbersText(numbers, "ko")}은 목록에 없어서 바꾼 건 없어요. 1번부터 ${count}번 중에서 알려주세요.`,
      changed: (numbers: readonly number[], url: string) => `${numbersText(numbers, "ko")}은 목록을 보낸 뒤 바뀌어서 바꾸지 않았어요. 여기서 다시 확인해주세요: ${url}`,
      alreadyAnswered: (numbers: readonly number[]) => `${numbersText(numbers, "ko")}은 이미 답하셨어요.`,
      calendarUnavailable: (url: string) => `지금 Google 캘린더를 읽지 못해서 바꾼 건 없어요. 잠시 후 다시 말씀하시거나 여기서 확인해주세요: ${url}`,
    },
    nextStep: {
      analyzing: "캘린더를 살펴보고 있어요. 곧 제안을 드릴게요.",
      choose_calendars: "확인할 캘린더와 예약을 넣을 캘린더를 골라 주세요. 여기서 말씀하시거나 아래 링크를 열어 주세요.",
      confirm_settings: "설정을 검토할 준비가 됐어요. 함께 살펴보자고 말씀해 주세요.",
      connect_calendar: "먼저 Google Calendar를 연결해 주세요. 연결은 브라우저에서 해요.",
      ready: "설정이 끝났어요. 설정이나 요청에 대해 물어보시거나 바꿀 내용을 말씀해 주세요.",
      review_suggestions: "제안된 설정을 함께 살펴봐요. 원하시는 내용을 말씀해 주세요.",
    } as Readonly<Record<string, string>>,
    openRequests: "진행 중인 요청:",
    requestLine: (ref: string, name: string, state: string) => `${ref}: ${name}님, ${state}`,
    whichRequest: "어떤 요청에 대해 이야기할지 말씀해 주세요.",
    noOpenRequests: "진행 중인 요청이 없어요.",
    ambiguousRef: (origin: string) => `그 참조 번호에 해당하는 요청이 여러 개예요. ${origin}/app 을 열어 주세요.`,
    unknownRef: (origin: string) => `그 참조 번호를 찾지 못했어요. 어떤 요청이 있는지 물어보시거나 ${origin}/app 을 열어 주세요.`,
    requestGoneHere: "그 요청은 더 이상 볼 수 없어요. 어떤 요청이 있는지 물어봐 주세요.",
    openToSetUp: (origin: string) => `설정하려면 ${origin}/app 을 열어 주세요.`,
    closedNothingChanged: (state: string) => `이 요청은 ${state} 상태라 바뀐 것이 없어요.`,
    proposalChanged: "제안이 바뀌었어요.",
    notCurrent: (current: string) => `그 제안은 더 이상 현재 제안이 아니에요. 현재 제안은 ${current}이에요. 보여 달라고 말씀해 주세요.`,
    noProposal: "아직 결정할 제안이 없어요.",
    approved: "승인했어요. 캘린더에 추가하고 있고, 확정되면 알려 드릴게요.",
    alreadyApproved: "이미 승인한 제안이에요. 예약이 진행 중이에요.",
    declined: "거절했어요. 요청자에게 알려지고, 예약된 것은 없어요.",
    cannotDecide: (current: string | null) =>
      current
        ? `지금은 그 제안을 결정할 수 없어요. 바뀌었거나 아직 요청자의 동의가 필요할 수 있어요. 현재 제안(${current})을 보여 달라고 말씀해 주세요.`
        : "지금은 그 제안을 결정할 수 없어요. 현재 제안을 보여 달라고 말씀해 주세요.",
    requestClosed: "이 요청은 종료되어 바뀐 것이 없어요.",
    bookingUnderWay: "이 요청의 예약이 진행 중이에요. 앱에서 확인해 주세요.",
    couldNotHere: (origin: string) => `여기서는 처리하지 못했어요. ${origin}/app 에서 이어서 해 주세요.`,
    noChanges: "이 요청에 제안된 변경 사항이 없어요. 바꾸고 싶은 내용을 말씀해 주세요.",
    suggestedChanges: (ref: string, parts: string) => `제안된 변경 사항 ${ref}: ${parts}`,
    shareOrDrop: "요청자에게 보내 달라고 하시거나, 취소해 달라고 말씀해 주세요.",
    chooseRequestFirst: "먼저 어떤 요청인지 말씀해 주세요.",
    notCurrentChanges: (current: string) => `현재 변경 제안이 아니에요. 현재 제안은 ${current}이에요. 보여 달라고 말씀해 주세요.`,
    noChangesToAct: "처리할 변경 제안이 없어요.",
    shared: "보냈어요. 새 시간을 확인한 뒤 요청자에게 동의를 받으려고 보낼게요.",
    dropped: "변경 제안을 취소했어요. 공유된 것은 없어요.",
    change: {
      start: (at: string) => `시작 ${at}`,
      minutes: (n: number) => `${n}분`,
      online: "온라인",
      inPerson: "대면",
      at: (place: string) => `장소 ${place}`,
      googleMeet: "Google Meet 링크",
      requesterLink: "요청자가 준 미팅 링크",
    },
    reviewNotCurrent: (current: string) => `그 검토는 더 이상 현재 검토가 아니에요. 현재 검토는 ${current}이에요. 보여 달라고 말씀해 주세요.`,
    calendarUnreadable: (origin: string) => `Google Calendar를 읽지 못했어요. ${origin}/app 에서 다시 연결한 뒤 다시 시도해 주세요.`,
    saved: (link: string) => `저장했어요. 예약 링크는 ${link} 이에요.`,
    destinationGone: (origin: string) => `그 캘린더에는 더 이상 예약을 추가할 수 없어요. ${origin}/app 에서 다른 캘린더를 골라 주세요.`,
    settingsMoved: "그사이 설정이 바뀌었어요. 현재 설정을 보여 달라고 말씀해 주세요.",
    couldNotSave: (origin: string) => `여기서는 저장하지 못했어요. ${origin}/app 을 열어 주세요.`,
    settingsHeader: "검토할 설정:",
    calendarsChecked: (names: string) => `확인하는 캘린더: ${names}`,
    bookingsGoTo: (name: string) => `예약을 넣을 캘린더: ${name}`,
    starterDefault: " (기본값)",
    suggested: " (제안)",
    stillNeeded: (what: string, origin: string) => `아직 필요한 것: ${what}. 여기서 답하시거나 ${origin}/app 을 열어 주세요.`,
    yourCalendars: "캘린더 선택",
    saveInWords: "맞으면 저장해 달라고 말씀해 주세요.",
    reviewTooLong: (origin: string) => `설정 검토 내용이 메시지로 보내기에 너무 길어요. ${origin}/app 에서 검토하고 저장해 주세요.`,
    minutes: (n: number) => `${n}분`,
    perWeek: (n: number) => `주 ${n}회`,
    none: "없음",
    decidePerMeeting: "미팅마다 정하기",
    tooLong: "메시지가 너무 길어서 Thyme에게 보낼 수 없어요. 더 짧게 보내 주세요.",
    requestGone: "그 요청은 더 이상 볼 수 없어서 이 메시지는 설정 대화로 보냈어요. 어떤 요청에 대해 이야기할지 말씀해 주세요.",
    unlinked: {
      imessage: "이 번호는 Find Me a Time 호스트와 연결되어 있지 않아요. findmeatime.com/app 에 로그인한 뒤 Connect iMessage를 선택해 주세요.",
      telegram: "이 Telegram 계정은 Find Me a Time 호스트와 연결되어 있지 않아요. findmeatime.com/app 에 로그인한 뒤 Connect Telegram을 선택해 주세요.",
      whatsapp: "이 번호는 Find Me a Time 호스트와 연결되어 있지 않아요. findmeatime.com/app 에 로그인한 뒤 Connect WhatsApp을 선택해 주세요.",
    } satisfies Record<StoredChannel, string>,
    textOnly: "텍스트 메시지만 읽을 수 있어요.",
    textOnlyTelegram: "텍스트 메시지만 읽을 수 있어요. 사진, 스티커, 음성 메시지는 Thyme에게 전달되지 않아요.",
    guestClosed: "이 요청은 종료되어 이제 여기 메시지는 Thyme에게 전달되지 않아요.",
    guestSwitched: (host: string) => `이제 ${host}님과의 요청에 대해 이야기해요.`,
    yourHost: "상대 호스트",
    hostSelected: "이제 호스트로서 내 Find Me a Time 계정에 대해 이야기해요.",
    picker: (guests: readonly { readonly name: string; readonly ref: string }[], host: boolean) =>
      [
        "어느 대화에 보내는 메시지인가요?",
        ...guests.map((guest) => `- ${guest.name}님과의 예약 요청 (${guest.ref})`),
        ...(host ? ["- 호스트로서 내 계정"] : []),
        "상대방 이름으로 말씀하시거나, \"호스트예요\"라고 말씀해 주세요.",
      ].join("\n"),
    readyForApproval: "승인을 기다리고 있어요.",
    followsDecline: (ref: string) => `거절하신 요청 ${ref}에 이어진 요청이에요.`,
    followsExpired: (ref: string) => `만료된 요청 ${ref}에 이어진 요청이에요.`,
    newRequest: (summary: string) => `새 요청: ${summary} 여기서 이야기하고 싶으시면 말씀해 주세요.`,
    booked: (name: string, when: string) => `${name}님과 예약됐어요: ${when}. 캘린더에 들어가 있어요.`,
    bookingFailed: (ref: string, when: string, link: string) => `요청 ${ref}(${when})의 예약이 확정되지 않았어요. Find Me a Time에서 확인해 주세요: ${link}`,
    bookingSlow: (ref: string, when: string, link: string) => `요청 ${ref}(${when})의 예약 확정이 평소보다 오래 걸리고 있어요. Find Me a Time에서 확인해 주세요: ${link}`,
  },
} as const;

export function channelReplies(language: ChannelLanguage) {
  return CHANNEL_REPLIES[language];
}
