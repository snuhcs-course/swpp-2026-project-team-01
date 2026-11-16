import type { HostRequestView } from "../contracts/host-request";
import type { StoredChannel } from "../contracts/messaging-channel";
import type { RequestState } from "../contracts/request";
import {
  SETUP_FIELD_NAMES,
  type SetupFieldName,
  TRAVEL_MODE_LABELS,
  meetsInPerson,
  WEEKLY_LIMIT_COUNT_LABELS,
  type WeeklyWindow,
} from "../contracts/setup";
import { approveCommand, declineCommand } from "./bookings";
import { type ChannelLanguage, hostConversationLanguage } from "./channel-language";
import { channelReplies, FIELD_LABELS, locale, STATE_WORDS, weekdayShort } from "./channel-texts";
import { type CommandDefinition, type CommandOutcome, runCommand } from "./commands";
import type { Database, Transaction } from "./database";
import { recordDestinationAccess } from "./calendar-roles";
import { CalendarAccessError, openHostCalendar } from "./google-calendar";
import { listHostRequests, readHostRequest } from "./host-requests";
import { calendarConnectUrl } from "./imessage-links";
import { callbackAnswerText, recordOutbound } from "./imessage-outbox";
import type { WhatsAppButtons } from "./photon";
import { requestRef, settingsRef } from "./request-ref";
import { WHATSAPP_BUTTON_CONTENT } from "./whatsapp";
import type { BoundMessage, ImessageReceiptDependencies, OpenedReceipt } from "./imessage-receipts";
import { computeSetupProposal, readSetupState } from "./setup";
import { confirmSettingsCommand } from "./setup-commands";
import { dismissChangesCommand, shareChangesCommand } from "./shared-changes";
import { enqueueSettingsButtonRetirement } from "./telegram-jobs";
import type { TokenKey } from "./token-encryption";

// Exact iMessage commands (host-imessage-channel design 8, D8). A command is
// the whole message, trimmed and compared case-insensitively; anything else is
// free text for the assistant, so "yes" never decides anything. References name
// exactly what a decision acts on:
//   - a request: six Crockford base32 characters from the SHA-256 of its ID;
//   - a proposal version: `<request>-<version>`;
//   - a suggested change: `<request>-S<n>`, n counting the request's suggestions;
//   - a settings review: the first eight characters of the setup proposal hash.
// Decisions run through the command pipeline as the linked host with the retry
// key imessage:{receiptId}, so a replayed message replays the saved outcome. A
// stale reference changes nothing and the reply names the current one. Every
// reply is one outbound message to the linked conversation.
// On Telegram (host-telegram-channel design 7 and 8, D8, D10) a command may start
// with "/" and end with the bot's @username, as the command menu sends it, and
// "/start" from a linked host is help. A summary that asks for a decision, and
// the settings review, carry inline buttons; a button tap arrives as a callback
// receipt whose data names one of these commands, runs here exactly like the
// typed command, and is answered: empty when it ran, with the current proposal
// when it named an older version.
// Since channel-actions-in-words (D2, D3) the host need not know any of this:
// every action also works in words through Thyme's tools, the commands keep
// working for buttons and for hosts who type them, and no reply asks for one.
// Replies follow the conversation's language, English or Korean (D4).

export type ParsedCommand =
  | { readonly name: "help" | "requests" | "setup" | "review" | "changes" | "stop" }
  | { readonly name: "request" | "share" | "dismiss" | "approve" | "decline" | "confirm"; readonly ref: string };

// "unlink" is the same as "stop" (host-whatsapp-channel design 8, D12).
const BARE = new Set(["help", "requests", "setup", "review", "changes", "stop", "unlink"]);
const WITH_REF = new Set(["request", "share", "dismiss", "approve", "decline", "confirm"]);

// A Telegram command word: "/name", optionally "@<bot username>" (every bot's ends in "bot").
const SLASHED = /^\/([a-z]+)(?:@[a-z][a-z0-9_]{1,28}bot)?$/i;

export function parseCommand(text: string): ParsedCommand | null {
  const words = text.trim().split(/\s+/);
  const slashed = SLASHED.exec(words[0] ?? "");
  const name = (slashed ? slashed[1]! : (words[0] ?? "")).toLowerCase();

  if (slashed && name === "start" && words.length === 1) return { name: "help" };
  if (words.length === 1 && BARE.has(name)) return { name: name === "unlink" ? "stop" : name } as ParsedCommand;
  if (words.length === 2 && WITH_REF.has(name) && /^[0-9a-z-]{4,20}$/i.test(words[1]!)) {
    return { name, ref: words[1]!.toUpperCase() } as ParsedCommand;
  }
  return null;
}

export { requestRef } from "./request-ref";

export function reviewRef(requestId: string, version: number) {
  return `${requestRef(requestId)}-${version}`;
}

export { settingsRef } from "./request-ref";

// The help reply (D3): what the host can say, not which commands exist.
export function helpText(origin: string, language: ChannelLanguage, telegram = false) {
  const texts = channelReplies(language);
  return telegram ? `${texts.help(origin)}\n${texts.telegramHelp}` : texts.help(origin);
}

export const STOP_TEXTS = channelReplies("en").stop;

// What a button tap's spinner is answered with (design 7). Success answers with nothing.
export const CALLBACK_TEXTS = {
  stale: channelReplies("en").callbackStale,
  notLinked: channelReplies("en").callbackNotLinked,
} as const;

// Answers a button tap once, keyed by its receipt; nothing for any other receipt.
export async function answerCallback(
  tx: Transaction,
  tokenKey: TokenKey,
  receipt: OpenedReceipt,
  recipient: { readonly address: string; readonly spaceId: string },
  text: string | null,
) {
  const callbackId = receipt.telegram?.callbackId;
  if (receipt.contentType !== "callback" || !callbackId) return;
  await recordOutbound(tx, {
    channel: "telegram",
    dedupeKey: `receipt:${receipt.id}:answer`,
    kind: "callback_answer",
    recipient,
    recipientHash: receipt.senderHash,
    text: callbackAnswerText({ callbackId, text }),
    tokenKey,
  });
}

const CLOSED: readonly RequestState[] = ["booked", "declined", "withdrawn", "expired"];
function meetingTime(start: string, end: string, zone: string, language: ChannelLanguage = "en") {
  const day = new Intl.DateTimeFormat(locale(language), { day: "numeric", month: "short", timeZone: zone, weekday: "short" }).format(new Date(start));
  const clock = new Intl.DateTimeFormat(locale(language), { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${day}, ${clock.format(new Date(start))}–${clock.format(new Date(end))} (${zone})`;
}

// The request's summary as the review command and the summaries show it. A
// proposal awaiting approval says the host may decide in words (D3).
export function requestSummary(view: HostRequestView, language: ChannelLanguage = "en") {
  const texts = channelReplies(language);
  const ref = requestRef(view.requestId);
  const lines: string[] = [texts.request(ref, view.requester.name, view.details.purpose)];

  if (view.proposal) {
    const place = view.proposal.mode === "online" ? texts.online : texts.inPerson(view.proposal.location);
    lines.push(texts.proposal(view.proposal.version, meetingTime(view.proposal.start, view.proposal.end, view.hostTimezone, language), view.proposal.durationMinutes, place));
  }

  lines.push(texts.status(STATE_WORDS[language][view.state]));

  if (view.state === "awaiting_host_approval" && view.proposal?.agreedAt) lines.push(texts.decideInWords);
  return lines.join("\n");
}

// The buttons under a summary that asks for a decision (host-whatsapp-channel
// design 11, D17; host-telegram-channel design 7, D8): WhatsApp reply buttons
// and Telegram's inline keyboard (the outbox drops them on iMessage), with IDs
// that name the exact request and version.
export const BUTTON_TITLES = channelReplies("en").buttons;

export function decisionButtons(view: HostRequestView, language: ChannelLanguage = "en"): WhatsAppButtons | undefined {
  if (view.state !== "awaiting_host_approval" || !view.proposal?.agreedAt) return undefined;
  const texts = channelReplies(language);
  const ref = requestRef(view.requestId);
  const decision = reviewRef(view.requestId, view.proposal.version);
  return {
    items: [
      { id: `a:${decision}`, title: texts.buttons.approve },
      { id: `d:${decision}`, title: texts.buttons.decline },
      { id: `s:${ref}`, title: texts.buttons.details },
    ],
    prompt: texts.decidePrompt(ref),
  };
}

export function settingsButtons(proposalHash: string, language: ChannelLanguage = "en"): WhatsAppButtons {
  const texts = channelReplies(language);
  return { items: [{ id: `c:${settingsRef(proposalHash)}`, title: texts.buttons.confirm }], prompt: texts.savePrompt };
}

function windowsText(windows: readonly WeeklyWindow[], language: ChannelLanguage) {
  return windows.map((window) => `${weekdayShort(window.weekday, language)} ${window.start}–${window.end}`).join(", ");
}

function fieldText(field: SetupFieldName, value: unknown, language: ChannelLanguage) {
  const texts = channelReplies(language);
  switch (field) {
    case "weeklyWindows":
      return windowsText(value as WeeklyWindow[], language);
    case "durationMinutes":
    case "bufferBeforeMinutes":
    case "bufferAfterMinutes":
    case "travelBufferMinutes":
      return texts.minutes(value as number);
    case "weeklyLimit":
      return value === null ? texts.none : texts.perWeek(value as number);
    case "weeklyLimitCounts":
      return WEEKLY_LIMIT_COUNT_LABELS[value as keyof typeof WEEKLY_LIMIT_COUNT_LABELS] ?? String(value);
    case "groupTrips":
      return texts.groupTrips(value === true);
    case "travelMode":
      return TRAVEL_MODE_LABELS[value as keyof typeof TRAVEL_MODE_LABELS] ?? String(value);
    case "location": {
      const answer = value as { kind: string; areas?: string[]; venue?: string | null };
      return answer.kind === "decide_per_meeting" ? texts.decidePerMeeting : [...(answer.areas ?? []), answer.venue].filter(Boolean).join(", ");
    }
    case "noteExclusions":
      return `${(value as unknown[]).length}`;
    default:
      return String(value);
  }
}

export const MAX_REVIEW_CHARS = 1_500;

// The authored settings review: every proposed value with its source, the
// calendars and what is still missing. A complete review ends by saying the
// host may tell Thyme to save it (D3); the Confirm settings button still
// carries its reference.
export async function settingsReview(db: Database, hostAccountId: string, origin: string, language: ChannelLanguage = "en"): Promise<Reply> {
  const texts = channelReplies(language);
  const proposal = await computeSetupProposal(db, hostAccountId);
  if (!proposal) return { text: texts.openToSetUp(origin) };

  const lines: string[] = [texts.settingsHeader];
  if (proposal.roles) {
    lines.push(
      texts.calendarsChecked(proposal.roles.conflictCalendars.map((calendar) => calendar.summary).join(", ")),
      texts.bookingsGoTo(proposal.roles.bookingCalendar.summary),
    );
  }
  for (const field of SETUP_FIELD_NAMES) {
    const entry = proposal.proposed[field];
    if (!entry) continue;
    if (field === "weeklyLimitCounts" && proposal.proposed.weeklyLimit?.value == null) continue;
    // Trip grouping applies only to in-person meetings.
    if (field === "groupTrips" && !meetsInPerson(proposal.proposed.meetingMode?.value)) continue;
    const source = entry.source === "starter_default" ? texts.starterDefault : entry.source === "inferred" ? texts.suggested : "";
    lines.push(`${FIELD_LABELS[language][field]}: ${fieldText(field, entry.value, language)}${source}`);
  }

  const ready = Boolean(proposal.roles) && proposal.missingFields.length === 0;
  if (!ready) {
    const missing = proposal.missingFields.map((field) => FIELD_LABELS[language][field].toLowerCase());
    lines.push(texts.stillNeeded(proposal.roles ? missing.join(", ") : texts.yourCalendars, origin));
  } else {
    lines.push(texts.saveInWords);
  }

  const text = lines.join("\n");
  if (text.length > MAX_REVIEW_CHARS) return { text: texts.reviewTooLong(origin) };
  return ready ? { buttons: settingsButtons(proposal.proposalHash, language), text } : { text };
}

export type CommandDependencies = ImessageReceiptDependencies;

type Reply = {
  readonly text: string;
  readonly buttons?: WhatsAppButtons;
  // The answer to the Telegram button tap that asked for this reply.
  readonly answer?: string | null;
};

function reply(
  tx: Transaction,
  deps: CommandDependencies,
  message: BoundMessage,
  text: string,
  requestId: string | null = null,
  selectHost = false,
  buttons?: WhatsAppButtons,
) {
  return recordOutbound(tx, {
    bindingId: message.bindingId,
    buttons,
    dedupeKey: `${selectHost ? "host-selection" : "receipt"}:${message.receipt.id}`,
    hostAccountId: message.hostAccountId,
    kind: "command",
    recipient: message.recipient,
    recipientHash: message.receipt.senderHash,
    requestId,
    text,
    tokenKey: deps.tokenKey,
  });
}

// The host's request a reference names, or why there is none.
async function requestByRef(deps: CommandDependencies, hostAccountId: string, ref: string) {
  const rows = await deps.db<{ id: string }[]>`
    select id from app.requests where host_account_id = ${hostAccountId} and state <> 'draft'
  `;
  const matches = rows.filter((row) => requestRef(row.id) === ref);
  if (matches.length !== 1) return { error: matches.length === 0 ? "unknown" : "ambiguous" } as const;
  return { requestId: matches[0]!.id } as const;
}

// `<request>-<suffix>` split, or null.
function splitRef(ref: string) {
  const index = ref.indexOf("-");
  return index === 6 ? { request: ref.slice(0, 6), suffix: ref.slice(7) } : null;
}

function run<Input, Result>(
  deps: CommandDependencies,
  message: BoundMessage,
  command: CommandDefinition<Input, Result>,
  resourceId: string,
  input: unknown,
  expectedRevision: number | null = null,
): Promise<CommandOutcome<Result>> {
  return runCommand(
    { authenticate: async () => ({ id: message.hostAccountId, kind: "host_account" }), db: deps.db },
    command,
    { expectedRevision, input, resourceId, retryKey: `imessage:${message.receipt.id}` },
  );
}

function changeTexts(changes: NonNullable<HostRequestView["suggestion"]>["changes"], zone: string, language: ChannelLanguage) {
  const texts = channelReplies(language).change;
  const parts: string[] = [];
  if (changes.start) {
    const at = new Intl.DateTimeFormat(locale(language), { day: "numeric", hour: "numeric", minute: "2-digit", month: "short", timeZone: zone, weekday: "short" });
    parts.push(texts.start(`${at.format(new Date(changes.start))} (${zone})`));
  }
  if (changes.durationMinutes) parts.push(texts.minutes(changes.durationMinutes));
  if (changes.mode) parts.push(changes.mode === "online" ? texts.online : texts.inPerson);
  if (changes.location) parts.push(texts.at(changes.location));
  if (changes.linkPlan) parts.push(changes.linkPlan.kind === "google_meet" ? texts.googleMeet : texts.requesterLink);
  return parts;
}

async function decide(
  deps: CommandDependencies,
  message: BoundMessage,
  kind: "approve" | "decline",
  ref: string,
  language: ChannelLanguage,
): Promise<Reply & { requestId?: string }> {
  const texts = channelReplies(language);
  const parts = splitRef(ref);
  const version = parts ? Number(parts.suffix) : Number.NaN;
  const found = parts && Number.isInteger(version) && version > 0 ? await requestByRef(deps, message.hostAccountId, parts.request) : null;
  if (!found || "error" in found) return { text: texts.unknownRef(deps.origin) };

  const view = await readHostRequest(deps.db, message.hostAccountId, found.requestId);
  if (!view) return { text: texts.unknownRef(deps.origin) };
  const current = view.proposal ? reviewRef(view.requestId, view.proposal.version) : null;

  if (CLOSED.includes(view.state)) return { requestId: view.requestId, text: texts.closedNothingChanged(STATE_WORDS[language][view.state]) };
  if (!view.proposal || view.proposal.version !== version) {
    // A stale tap shows the current proposal, since WhatsApp cannot take the
    // old buttons back (D17). On Telegram the tap's answer says it changed (D8).
    if (message.receipt.contentType === WHATSAPP_BUTTON_CONTENT) {
      return { buttons: decisionButtons(view, language), requestId: view.requestId, text: `${texts.proposalChanged}\n${requestSummary(view, language)}` };
    }
    if (message.receipt.contentType === "callback") {
      return { answer: texts.callbackStale, buttons: decisionButtons(view, language), requestId: view.requestId, text: requestSummary(view, language) };
    }
    return { requestId: view.requestId, text: current ? texts.notCurrent(current) : texts.noProposal };
  }

  if (kind === "approve") {
    // The reference names the version; the revision read with it makes sure
    // nothing changed between this read and the decision.
    const outcome = await run(deps, message, approveCommand, view.requestId, { version }, view.revision);
    if (outcome.ok) return { requestId: view.requestId, text: outcome.result.repeated ? texts.alreadyApproved : texts.approved };
    return { requestId: view.requestId, text: decisionRefusal(deps, outcome.error.category, current, language) };
  }

  const outcome = await run(deps, message, declineCommand(() => deps.notices), view.requestId, {}, view.revision);
  return { requestId: view.requestId, text: outcome.ok ? texts.declined : decisionRefusal(deps, outcome.error.category, current, language) };
}

function decisionRefusal(deps: CommandDependencies, category: string, current: string | null, language: ChannelLanguage) {
  const texts = channelReplies(language);
  switch (category) {
    case "stale_revision":
      return texts.cannotDecide(current);
    case "request_closed":
      return texts.requestClosed;
    case "booking_pending":
      return texts.bookingUnderWay;
    default:
      return texts.couldNotHere(deps.origin);
  }
}

async function changes(
  deps: CommandDependencies,
  message: BoundMessage,
  kind: "show" | "share" | "dismiss",
  language: ChannelLanguage,
  ref?: string,
): Promise<Reply & { requestId?: string }> {
  const texts = channelReplies(language);
  let requestId = message.selectedRequestId;
  let number: number | null = null;

  if (ref) {
    const parts = splitRef(ref);
    number = parts && /^S\d+$/.test(parts.suffix) ? Number(parts.suffix.slice(1)) : null;
    const found = parts && number ? await requestByRef(deps, message.hostAccountId, parts.request) : null;
    if (!found || "error" in found) return { text: texts.unknownRef(deps.origin) };
    requestId = found.requestId;
  }
  if (!requestId) return { text: texts.chooseRequestFirst };

  const [request] = await deps.db<{ revision: number }[]>`
    select revision from app.requests where id = ${requestId} and host_account_id = ${message.hostAccountId}
  `;
  const drafts = await deps.db<{ id: string; state: string }[]>`
    select d.id, d.state from app.shared_change_drafts d join app.requests r on r.id = d.request_id
    where d.request_id = ${requestId} and r.host_account_id = ${message.hostAccountId}
    order by d.created_at, d.id
  `;
  const pendingIndex = drafts.findIndex((draft) => draft.state === "pending");
  const pendingRef = pendingIndex >= 0 ? `${requestRef(requestId)}-S${pendingIndex + 1}` : null;

  if (kind === "show") {
    const view = await readHostRequest(deps.db, message.hostAccountId, requestId);
    if (!view?.suggestion || view.suggestion.state !== "pending" || !pendingRef) return { requestId, text: texts.noChanges };
    const parts = changeTexts(view.suggestion.changes, view.hostTimezone, language);
    return { requestId, text: [texts.suggestedChanges(pendingRef, parts.join("; ")), texts.shareOrDrop].join("\n") };
  }

  if (!pendingRef || number !== pendingIndex + 1) {
    return { requestId, text: pendingRef ? texts.notCurrentChanges(pendingRef) : texts.noChangesToAct };
  }

  const input = { suggestionId: drafts[pendingIndex]!.id };
  const outcome =
    kind === "share"
      ? await run(deps, message, shareChangesCommand, requestId, input, request?.revision ?? null)
      : await run(deps, message, dismissChangesCommand, requestId, input, request?.revision ?? null);
  if (!outcome.ok) return { requestId, text: decisionRefusal(deps, outcome.error.category, null, language) };
  return { requestId, text: kind === "share" ? texts.shared : texts.dropped };
}

async function confirmSettings(deps: CommandDependencies, message: BoundMessage, ref: string, language: ChannelLanguage): Promise<Reply & { saved?: boolean }> {
  const texts = channelReplies(language);
  const proposal = await computeSetupProposal(deps.db, message.hostAccountId);
  if (!proposal || settingsRef(proposal.proposalHash) !== ref) {
    return { text: proposal ? texts.reviewNotCurrent(settingsRef(proposal.proposalHash)) : texts.openToSetUp(deps.origin) };
  }

  let live;
  try {
    live = (await (await openHostCalendar(deps.setup.calendar, message.hostAccountId)).listCalendars()).calendars;
  } catch (error) {
    if (error instanceof CalendarAccessError) return { text: texts.calendarUnreadable(deps.origin) };
    throw error;
  }

  const outcome = await run(deps, message, confirmSettingsCommand(live, deps.setup.appOrigin, { bindingId: message.bindingId }), message.hostAccountId, { proposalHash: proposal.proposalHash }, proposal.records.draftRevision);
  if (outcome.ok) return { saved: true, text: texts.saved(outcome.result.links.booking) };
  if (outcome.error.reason === "destination_not_writable") {
    await recordDestinationAccess(deps.db, message.hostAccountId, live);
    return { text: texts.destinationGone(deps.origin) };
  }
  return { text: outcome.error.category === "stale_revision" ? texts.settingsMoved : texts.couldNotSave(deps.origin) };
}

// The reply to a decision this receipt already made, from its saved command
// outcome, so a retried receipt answers as the first attempt did even when the
// request has moved on since.
async function savedDecisionReply(
  deps: CommandDependencies,
  message: BoundMessage,
  language: ChannelLanguage,
): Promise<(Reply & { requestId: string | null }) | null> {
  const texts = channelReplies(language);
  const [saved] = await deps.db<{ operation: string; resource_id: string; result: Record<string, unknown> | null }[]>`
    select operation, resource_id, result from app.command_outcomes
    where actor = ${`host_account:${message.hostAccountId}`} and retry_key = ${`imessage:${message.receipt.id}`}
  `;
  if (!saved) return null;
  const requestId = saved.operation === "setup.confirm_settings" ? null : saved.resource_id;

  switch (saved.operation) {
    case "request.approve":
      return { requestId, text: saved.result?.repeated ? texts.alreadyApproved : texts.approved };
    case "request.decline":
      return { requestId, text: texts.declined };
    case "request.share_changes":
      return { requestId, text: texts.shared };
    case "request.dismiss_changes":
      return { requestId, text: texts.dropped };
    case "setup.confirm_settings": {
      const links = saved.result?.links as { booking?: string } | undefined;
      return { requestId, text: texts.saved(links?.booking ?? `${deps.origin}/app`) };
    }
    default:
      return null;
  }
}

const DECISIONS = new Set(["approve", "decline", "share", "dismiss", "confirm"]);

// Runs a parsed command for a bound host and queues its reply, in the language
// of the host's conversation (D4): a command word or a button says nothing
// about the language the host speaks.
export async function executeCommand(tx: Transaction, deps: CommandDependencies, message: BoundMessage, command: ParsedCommand) {
  let result: Reply & { requestId?: string | null };
  const telegram = message.receipt.channel === "telegram";
  const language = await hostConversationLanguage(deps.db, message.hostAccountId);
  const texts = channelReplies(language);

  const replayed = DECISIONS.has(command.name) ? await savedDecisionReply(deps, message, language) : null;
  if (replayed) {
    await reply(tx, deps, message, replayed.text, replayed.requestId);
    await answerCallback(tx, deps.tokenKey, message.receipt, message.recipient, null);
    return "command" as const;
  }

  switch (command.name) {
    case "help":
      result = { text: helpText(deps.origin, language, telegram) };
      break;
    case "stop": {
      // Ends the binding as Unlink does (D12); the confirmation is not host-private,
      // so it still goes out after the binding ended, and nothing queued does.
      const ended = await tx<{ id: string; channel: StoredChannel }[]>`
        update app.imessage_bindings set state = 'unlinked', ended_at = now(), sender_ciphertext = null, space_ciphertext = null
        where id = ${message.bindingId} and state = 'active'
        returning id, channel
      `;
      await tx`
        update app.imessage_outbox
        set state = 'suppressed', failure_category = 'unlinked', recipient_ciphertext = null, text_ciphertext = null,
            completed_at = now(), updated_at = now()
        where binding_id = ${message.bindingId} and state in ('waiting', 'queued')
      `;
      await recordOutbound(tx, {
        channel: ended[0]?.channel ?? message.receipt.channel,
        dedupeKey: `receipt:${message.receipt.id}`,
        hostAccountId: message.hostAccountId,
        kind: "command",
        recipient: message.recipient,
        recipientHash: message.receipt.senderHash,
        text: texts.stop[message.receipt.channel],
        tokenKey: deps.tokenKey,
      });
      await answerCallback(tx, deps.tokenKey, message.receipt, message.recipient, null);
      return "command" as const;
    }
    case "requests": {
      const open = (await listHostRequests(deps.db, message.hostAccountId)).filter((item) => !CLOSED.includes(item.state)).slice(0, 10);
      result = {
        text:
          open.length === 0
            ? texts.noOpenRequests
            : [texts.openRequests, ...open.map((item) => texts.requestLine(requestRef(item.requestId), item.requesterName, STATE_WORDS[language][item.state])), texts.whichRequest].join("\n"),
      };
      break;
    }
    case "request": {
      const found = await requestByRef(deps, message.hostAccountId, command.ref);
      if ("error" in found) {
        result = { text: found.error === "ambiguous" ? texts.ambiguousRef(deps.origin) : texts.unknownRef(deps.origin) };
        break;
      }
      await tx`update app.imessage_bindings set selected_request_id = ${found.requestId} where id = ${message.bindingId} and state = 'active'`;
      const view = await readHostRequest(deps.db, message.hostAccountId, found.requestId);
      result = {
        buttons: view ? decisionButtons(view, language) : undefined,
        requestId: found.requestId,
        text: `${view ? requestSummary(view, language) : ""}\n${texts.selectedRequest}`.trim(),
      };
      break;
    }
    case "setup": {
      await tx`update app.imessage_bindings set selected_request_id = null where id = ${message.bindingId} and state = 'active'`;
      const state = await readSetupState(deps.setup, message.hostAccountId);
      const next = state?.nextAction ?? "connect_calendar";
      // Calendar is connected in the browser and returns here (D19); the rest can be done in this conversation or /app.
      const link = next === "connect_calendar" ? calendarConnectUrl(deps.origin) : `${deps.origin}/app`;
      result = { text: `${texts.selectedSetup} ${texts.nextStep[next]}\n${link}` };
      break;
    }
    case "review": {
      if (message.selectedRequestId) {
        const view = await readHostRequest(deps.db, message.hostAccountId, message.selectedRequestId);
        result = view
          ? { buttons: decisionButtons(view, language), requestId: view.requestId, text: requestSummary(view, language) }
          : { text: texts.requestGoneHere };
      } else {
        result = await settingsReview(deps.db, message.hostAccountId, deps.origin, language);
      }
      break;
    }
    case "changes":
      result = await changes(deps, message, "show", language);
      break;
    case "share":
    case "dismiss":
      result = await changes(deps, message, command.name, language, command.ref);
      break;
    case "approve":
    case "decline":
      result = await decide(deps, message, command.name, command.ref, language);
      break;
    case "confirm": {
      const confirmed = await confirmSettings(deps, message, command.ref, language);
      if (confirmed.saved) await enqueueSettingsButtonRetirement(tx, message.hostAccountId, `imessage:${message.receipt.id}`);
      result = confirmed;
      break;
    }
  }

  await reply(
    tx,
    deps,
    message,
    result.text,
    result.requestId ?? null,
    command.name === "setup" || (command.name === "request" && Boolean(result.requestId)),
    result.buttons,
  );
  await answerCallback(tx, deps.tokenKey, message.receipt, message.recipient, result.answer ?? null);
  return "command" as const;
}
