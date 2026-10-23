import { createHash } from "node:crypto";
import type { HostRequestView } from "../contracts/host-request";
import type { RequestState } from "../contracts/request";
import { SETUP_FIELD_NAMES, type SetupFieldName, TRAVEL_MODE_LABELS, type WeeklyWindow } from "../contracts/setup";
import { approveCommand, declineCommand } from "./bookings";
import { type CommandDefinition, type CommandOutcome, runCommand } from "./commands";
import type { Database, Transaction } from "./database";
import { recordDestinationAccess } from "./calendar-roles";
import { CalendarAccessError, openHostCalendar } from "./google-calendar";
import { listHostRequests, readHostRequest } from "./host-requests";
import { recordOutbound } from "./imessage-outbox";
import type { BoundMessage, ImessageReceiptDependencies } from "./imessage-receipts";
import { computeSetupProposal, readSetupState } from "./setup";
import { confirmSettingsCommand } from "./setup-commands";
import { dismissChangesCommand, shareChangesCommand } from "./shared-changes";

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

export type ParsedCommand =
  | { readonly name: "help" | "requests" | "setup" | "review" | "changes" }
  | { readonly name: "request" | "share" | "dismiss" | "approve" | "decline" | "confirm"; readonly ref: string };

const BARE = new Set(["help", "requests", "setup", "review", "changes"]);
const WITH_REF = new Set(["request", "share", "dismiss", "approve", "decline", "confirm"]);

export function parseCommand(text: string): ParsedCommand | null {
  const words = text.trim().split(/\s+/);
  const name = words[0]?.toLowerCase() ?? "";

  if (words.length === 1 && BARE.has(name)) return { name } as ParsedCommand;
  if (words.length === 2 && WITH_REF.has(name) && /^[0-9a-z-]{4,20}$/i.test(words[1]!)) {
    return { name, ref: words[1]!.toUpperCase() } as ParsedCommand;
  }
  return null;
}

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function requestRef(requestId: string) {
  const bytes = createHash("sha256").update(requestId, "utf8").digest();
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 6) {
      out += ALPHABET[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length === 6) break;
  }
  return out;
}

export function reviewRef(requestId: string, version: number) {
  return `${requestRef(requestId)}-${version}`;
}

export function settingsRef(proposalHash: string) {
  return proposalHash.slice(0, 8).toUpperCase();
}

export const HELP_TEXT = [
  "Here's what you can send:",
  "requests: your open requests",
  "request <ref>: talk about one request here",
  "review: the current proposal, or your settings in setup",
  "changes: suggested changes to the selected request",
  "approve <ref> or decline <ref>: decide a proposal",
  "setup: continue setting up",
  "Anything else goes to Thyme.",
].join("\n");

const CLOSED: readonly RequestState[] = ["booked", "declined", "withdrawn", "expired"];
const STATE_WORDS: Readonly<Record<RequestState, string>> = {
  awaiting_host_approval: "awaiting your approval",
  booked: "booked",
  booking: "booking",
  declined: "declined",
  draft: "draft",
  expired: "expired",
  gathering: "gathering details",
  negotiating: "finding a time",
  withdrawn: "withdrawn",
};

function meetingTime(start: string, end: string, zone: string) {
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: zone, weekday: "short" }).format(new Date(start));
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${day}, ${clock.format(new Date(start))}–${clock.format(new Date(end))} (${zone})`;
}

// The request's summary as the review command and the summaries show it.
export function requestSummary(view: HostRequestView) {
  const ref = requestRef(view.requestId);
  const lines = [`Request ${ref} from ${view.requester.name}${view.details.purpose ? `: ${view.details.purpose}` : ""}.`];

  if (view.proposal) {
    const place = view.proposal.mode === "online" ? "online" : `in person${view.proposal.location ? ` at ${view.proposal.location}` : ""}`;
    lines.push(`Proposal ${view.proposal.version}: ${meetingTime(view.proposal.start, view.proposal.end, view.hostTimezone)}, ${view.proposal.durationMinutes} minutes, ${place}.`);
  }

  lines.push(`Status: ${STATE_WORDS[view.state]}.`);

  if (view.state === "awaiting_host_approval" && view.proposal?.agreedAt) {
    const decision = reviewRef(view.requestId, view.proposal.version);
    lines.push(`To approve, reply exactly: approve ${decision}`, `To decline: decline ${decision}`);
  }
  return lines.join("\n");
}

function windowsText(windows: readonly WeeklyWindow[]) {
  return windows.map((window) => `${window.weekday.slice(0, 3)} ${window.start}–${window.end}`).join(", ");
}

const FIELD_LABELS: Readonly<Record<SetupFieldName, string>> = {
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
  weeklyWindows: "Meeting hours",
};

function fieldText(field: SetupFieldName, value: unknown) {
  switch (field) {
    case "weeklyWindows":
      return windowsText(value as WeeklyWindow[]);
    case "durationMinutes":
    case "bufferBeforeMinutes":
    case "bufferAfterMinutes":
    case "travelBufferMinutes":
      return `${value as number} minutes`;
    case "weeklyLimit":
      return value === null ? "none" : `${value as number} a week`;
    case "travelMode":
      return TRAVEL_MODE_LABELS[value as keyof typeof TRAVEL_MODE_LABELS] ?? String(value);
    case "location": {
      const answer = value as { kind: string; areas?: string[]; venue?: string | null };
      return answer.kind === "decide_per_meeting" ? "decide per meeting" : [...(answer.areas ?? []), answer.venue].filter(Boolean).join(", ");
    }
    case "noteExclusions":
      return `${(value as unknown[]).length}`;
    default:
      return String(value);
  }
}

export const MAX_REVIEW_CHARS = 1_500;

// The authored settings review: every proposed value with its source, the
// calendars, what is still missing, and the exact confirm command.
export async function settingsReview(db: Database, hostAccountId: string, origin: string) {
  const proposal = await computeSetupProposal(db, hostAccountId);
  if (!proposal) return `Open ${origin}/app to set up.`;

  const lines = ["Your settings for review:"];
  if (proposal.roles) {
    lines.push(
      `Calendars checked: ${proposal.roles.conflictCalendars.map((calendar) => calendar.summary).join(", ")}`,
      `Bookings go to: ${proposal.roles.bookingCalendar.summary}`,
    );
  }
  for (const field of SETUP_FIELD_NAMES) {
    const entry = proposal.proposed[field];
    if (!entry) continue;
    const source = entry.source === "starter_default" ? " (starter default)" : entry.source === "inferred" ? " (suggested)" : "";
    lines.push(`${FIELD_LABELS[field]}: ${fieldText(field, entry.value)}${source}`);
  }

  if (!proposal.roles || proposal.missingFields.length > 0) {
    const missing = proposal.missingFields.map((field) => FIELD_LABELS[field].toLowerCase());
    lines.push(`Still needed: ${proposal.roles ? missing.join(", ") : "your calendars"}. Answer here, or open ${origin}/app.`);
  } else {
    lines.push(`To save these settings, reply exactly: confirm ${settingsRef(proposal.proposalHash)}`);
  }

  const text = lines.join("\n");
  return text.length > MAX_REVIEW_CHARS ? `Your settings review is too long for a message. Review and confirm it at ${origin}/app.` : text;
}

const NEXT_STEP_TEXT: Readonly<Record<string, string>> = {
  analyzing: "I'm looking at your calendars; I'll have suggestions shortly.",
  choose_calendars: "Choose which calendars to check and where bookings go. Tell me here, or open the link below.",
  confirm_settings: "Your settings are ready to review. Send review.",
  connect_calendar: "Connect Google Calendar first; that happens in the browser.",
  ready: "You're set up. Send review to see your settings, or tell me what to change.",
  review_suggestions: "Let's go through your suggested settings. Tell me what you prefer, or send review.",
};

export type CommandDependencies = ImessageReceiptDependencies;

type Reply = { readonly text: string };

function reply(tx: Transaction, deps: CommandDependencies, message: BoundMessage, text: string, requestId: string | null = null) {
  return recordOutbound(tx, {
    bindingId: message.bindingId,
    dedupeKey: `receipt:${message.receipt.id}`,
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

function changeTexts(changes: NonNullable<HostRequestView["suggestion"]>["changes"], zone: string) {
  const parts: string[] = [];
  if (changes.start) {
    const at = new Intl.DateTimeFormat("en-US", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short", timeZone: zone, weekday: "short" });
    parts.push(`start ${at.format(new Date(changes.start))} (${zone})`);
  }
  if (changes.durationMinutes) parts.push(`${changes.durationMinutes} minutes`);
  if (changes.mode) parts.push(changes.mode === "online" ? "online" : "in person");
  if (changes.location) parts.push(`at ${changes.location}`);
  if (changes.linkPlan) parts.push(changes.linkPlan.kind === "google_meet" ? "a Google Meet link" : "a meeting link the requester gave");
  return parts;
}

const STALE_REQUEST = (deps: CommandDependencies) => `I don't recognize that reference. Send requests to see yours, or open ${deps.origin}/app.`;

async function decide(
  deps: CommandDependencies,
  message: BoundMessage,
  kind: "approve" | "decline",
  ref: string,
): Promise<Reply & { requestId?: string }> {
  const parts = splitRef(ref);
  const version = parts ? Number(parts.suffix) : Number.NaN;
  const found = parts && Number.isInteger(version) && version > 0 ? await requestByRef(deps, message.hostAccountId, parts.request) : null;
  if (!found || "error" in found) return { text: STALE_REQUEST(deps) };

  const view = await readHostRequest(deps.db, message.hostAccountId, found.requestId);
  if (!view) return { text: STALE_REQUEST(deps) };
  const current = view.proposal ? reviewRef(view.requestId, view.proposal.version) : null;

  if (CLOSED.includes(view.state)) return { requestId: view.requestId, text: `This request is ${STATE_WORDS[view.state]}; nothing changed.` };
  if (!view.proposal || view.proposal.version !== version) {
    return {
      requestId: view.requestId,
      text: current ? `That proposal is no longer current. The current one is ${current}; send review to see it.` : "There's no proposal to decide yet.",
    };
  }

  if (kind === "approve") {
    // The reference names the version; the revision read with it makes sure
    // nothing changed between this read and the decision.
    const outcome = await run(deps, message, approveCommand, view.requestId, { version }, view.revision);
    if (outcome.ok) {
      return {
        requestId: view.requestId,
        text: outcome.result.repeated
          ? "That proposal is already approved; the booking is under way."
          : "Approved. I'm adding it to your calendar and will tell you when it's confirmed.",
      };
    }
    return { requestId: view.requestId, text: decisionRefusal(deps, outcome.error.category, current) };
  }

  const outcome = await run(deps, message, declineCommand(() => deps.notices), view.requestId, {}, view.revision);
  return {
    requestId: view.requestId,
    text: outcome.ok ? "Declined. The requester will be told; nothing was booked." : decisionRefusal(deps, outcome.error.category, current),
  };
}

function decisionRefusal(deps: CommandDependencies, category: string, current: string | null) {
  switch (category) {
    case "stale_revision":
      return current
        ? `That proposal can't be decided now; it may have changed or still need the requester's agreement. Send review for the current one (${current}).`
        : "That proposal can't be decided now. Send review.";
    case "request_closed":
      return "This request is closed; nothing changed.";
    case "booking_pending":
      return "A booking for this request is under way; check it in the app.";
    default:
      return `I couldn't do that here. Open ${deps.origin}/app to continue.`;
  }
}

async function changes(deps: CommandDependencies, message: BoundMessage, kind: "show" | "share" | "dismiss", ref?: string): Promise<Reply & { requestId?: string }> {
  let requestId = message.selectedRequestId;
  let number: number | null = null;

  if (ref) {
    const parts = splitRef(ref);
    number = parts && /^S\d+$/.test(parts.suffix) ? Number(parts.suffix.slice(1)) : null;
    const found = parts && number ? await requestByRef(deps, message.hostAccountId, parts.request) : null;
    if (!found || "error" in found) return { text: STALE_REQUEST(deps) };
    requestId = found.requestId;
  }
  if (!requestId) return { text: "Choose a request first: send requests, then request <ref>." };

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
    if (!view?.suggestion || view.suggestion.state !== "pending" || !pendingRef) {
      return { requestId, text: "There are no suggested changes for this request. Tell me what you'd like to change." };
    }
    const parts = changeTexts(view.suggestion.changes, view.hostTimezone);
    return {
      requestId,
      text: [`Suggested changes ${pendingRef}: ${parts.join("; ")}.`, `To share them with the requester, reply exactly: share ${pendingRef}`, `To drop them: dismiss ${pendingRef}`].join("\n"),
    };
  }

  if (!pendingRef || number !== pendingIndex + 1) {
    return { requestId, text: pendingRef ? `Those aren't the current suggestions. The current ones are ${pendingRef}; send changes.` : "There are no suggested changes to act on." };
  }

  const input = { suggestionId: drafts[pendingIndex]!.id };
  const outcome =
    kind === "share"
      ? await run(deps, message, shareChangesCommand, requestId, input, request?.revision ?? null)
      : await run(deps, message, dismissChangesCommand, requestId, input, request?.revision ?? null);
  if (!outcome.ok) return { requestId, text: decisionRefusal(deps, outcome.error.category, null) };
  return {
    requestId,
    text: kind === "share" ? "Shared. I'll check the new time and send it to the requester for agreement." : "Dropped those suggestions; nothing was shared.",
  };
}

async function confirmSettings(deps: CommandDependencies, message: BoundMessage, ref: string): Promise<Reply> {
  const proposal = await computeSetupProposal(deps.db, message.hostAccountId);
  if (!proposal || settingsRef(proposal.proposalHash) !== ref) {
    return {
      text: proposal ? `That review is no longer current. The current one is ${settingsRef(proposal.proposalHash)}; send review to see it.` : `Open ${deps.origin}/app to set up.`,
    };
  }

  let live;
  try {
    live = (await (await openHostCalendar(deps.setup.calendar, message.hostAccountId)).listCalendars()).calendars;
  } catch (error) {
    if (error instanceof CalendarAccessError) return { text: `Google Calendar couldn't be read. Reconnect it at ${deps.origin}/app, then try again.` };
    throw error;
  }

  const outcome = await run(deps, message, confirmSettingsCommand(live, deps.setup.appOrigin), message.hostAccountId, { proposalHash: proposal.proposalHash }, proposal.records.draftRevision);
  if (outcome.ok) return { text: `Saved. Your booking link is ${outcome.result.links.booking}` };
  if (outcome.error.reason === "destination_not_writable") {
    await recordDestinationAccess(deps.db, message.hostAccountId, live);
    return { text: `Bookings can't be added to that calendar any more. Choose another at ${deps.origin}/app.` };
  }
  return { text: outcome.error.category === "stale_revision" ? "Your settings changed meanwhile. Send review for the current ones." : `I couldn't save that here. Open ${deps.origin}/app.` };
}

// Runs a parsed command for a bound host and queues its reply.
export async function executeCommand(tx: Transaction, deps: CommandDependencies, message: BoundMessage, command: ParsedCommand) {
  let result: Reply & { requestId?: string | null };

  switch (command.name) {
    case "help":
      result = { text: HELP_TEXT };
      break;
    case "requests": {
      const open = (await listHostRequests(deps.db, message.hostAccountId)).filter((item) => !CLOSED.includes(item.state)).slice(0, 10);
      result = {
        text:
          open.length === 0
            ? "You have no open requests."
            : ["Your open requests:", ...open.map((item) => `${requestRef(item.requestId)}: ${item.requesterName}, ${STATE_WORDS[item.state]}`), "Send request <ref> to talk about one."].join("\n"),
      };
      break;
    }
    case "request": {
      const found = await requestByRef(deps, message.hostAccountId, command.ref);
      if ("error" in found) {
        result = { text: found.error === "ambiguous" ? `That reference matches more than one request. Open ${deps.origin}/app.` : STALE_REQUEST(deps) };
        break;
      }
      await tx`update app.imessage_bindings set selected_request_id = ${found.requestId} where id = ${message.bindingId} and state = 'active'`;
      const view = await readHostRequest(deps.db, message.hostAccountId, found.requestId);
      result = { requestId: found.requestId, text: `${view ? requestSummary(view) : ""}\nMessages here now go to this request.`.trim() };
      break;
    }
    case "setup": {
      await tx`update app.imessage_bindings set selected_request_id = null where id = ${message.bindingId} and state = 'active'`;
      const state = await readSetupState(deps.setup, message.hostAccountId);
      result = { text: `Setup selected. ${NEXT_STEP_TEXT[state?.nextAction ?? "connect_calendar"]}\n${deps.origin}/app` };
      break;
    }
    case "review": {
      if (message.selectedRequestId) {
        const view = await readHostRequest(deps.db, message.hostAccountId, message.selectedRequestId);
        result = view ? { requestId: view.requestId, text: requestSummary(view) } : { text: "That request isn't available any more. Send requests." };
      } else {
        result = { text: await settingsReview(deps.db, message.hostAccountId, deps.origin) };
      }
      break;
    }
    case "changes":
      result = await changes(deps, message, "show");
      break;
    case "share":
    case "dismiss":
      result = await changes(deps, message, command.name, command.ref);
      break;
    case "approve":
    case "decline":
      result = await decide(deps, message, command.name, command.ref);
      break;
    case "confirm":
      result = await confirmSettings(deps, message, command.ref);
      break;
  }

  await reply(tx, deps, message, result.text, result.requestId ?? null);
  return "command" as const;
}
