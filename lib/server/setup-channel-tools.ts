import { z } from "zod";
import { readCalendarRoles, saveCalendarRolesCommand, recordDestinationAccess } from "./calendar-roles";
import { channelOfTurn } from "./channel-selection";
import { CommandError, runCommand } from "./commands";
import { CalendarAccessError, openHostCalendar } from "./google-calendar";
import { hostRequestsForModel, QUOTED_NOTE, SELECT_NOTE } from "./host-review-tools";
import { listHostRequests } from "./host-requests";
import { settingsRef } from "./request-ref";
import { computeSetupProposal, readSetupState, missingFields, setupDependenciesFromEnvironment, withStatedAnswers, type SetupDependencies } from "./setup";
import { confirmSettingsCommand } from "./setup-commands";
import { authorizeSetupTool, type SetupToolCall } from "./setup-tools";
import { activeBindingOfHost, bindingRecipient } from "./imessage-links";
import { encodeDisplayName } from "./entry-documents";
import { hostConversationLanguage } from "./channel-language";
import { recordOutbound } from "./imessage-outbox";
import { lockCalendarRoles, lockDraft } from "./analysis";
import { normalizeBusy } from "./feasibility";
import { computeSlotPreview, nextWeekRange } from "./slot-preview";
import type { SlotPreview } from "../contracts/slot-preview";
import { channelReplies } from "./channel-texts";
import type { Queryable, Transaction } from "./database";
import type { ClaimedJob, JobHandler } from "./jobs";
import { slotPreviewNoteExclusions } from "./note-decisions";
import { readNoteReview } from "./note-review";
import { noteReviewLinkKey, noteStepOf } from "./onboarding-note-step";
import { SETUP_FIELD_SCHEMAS } from "../contracts/setup";
import { enqueueSettingsButtonRetirement } from "./telegram-jobs";

// The host's actions from setup in their own words (channel-actions-in-words
// D1, issue #138). list_host_requests answers "do I have any requests?" in setup,
// on the web and in the linked conversation alike, since it only reads.
// confirm_settings saves the reviewed settings when the host, writing from
// their linked iMessage, WhatsApp or Telegram, clearly says to save them; on
// the web the host presses Confirm and save proposed settings. It names the
// review it confirms by its reference, as `confirm <ref>` does, and runs the
// same command, so a review that moved on saves nothing.

export async function listHostRequestsForSetupTool(deps: SetupDependencies, call: SetupToolCall) {
  const actor = await authorizeSetupTool(deps.db, call.auth, call.sessionId);
  return { dataNote: QUOTED_NOTE, requests: hostRequestsForModel(await listHostRequests(deps.db, actor.id)), selectNote: SELECT_NOTE };
}

export const confirmSettingsToolInput = z
  .object({
    reviewRef: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z]{8}$/)
      .describe("The reviewRef from your latest read_setup_state result: the settings review the host agreed to."),
  })
  .strict();

export async function confirmSettingsForTool(deps: SetupDependencies, call: SetupToolCall, input: z.infer<typeof confirmSettingsToolInput>) {
  const actor = await authorizeSetupTool(deps.db, call.auth, call.sessionId);
  const channel = await channelOfTurn(deps.db, call.sessionId, actor.id);
  if (!channel) {
    return { problem: "Saving in words works only from the host's linked iMessage, WhatsApp or Telegram. On the web, the host presses Confirm and save proposed settings.", saved: false as const };
  }

  const binding = await activeBindingOfHost(deps.db, actor.id);
  if (!binding || binding.channel !== channel) return { saved: false as const, problem: "This conversation is no longer linked." };

  const state = await readSetupState(deps, actor.id);
  if (!state) return { problem: "Setup is not available now.", saved: false as const };
  const current = settingsRef(state.proposalHash);
  // Saved settings that nothing has changed since are already this review.
  if (state.readiness.ready && !state.pendingChanges && current === input.reviewRef.toUpperCase()) {
    return { links: state.links, message: "These settings are already saved.", saved: true as const };
  }
  if (current !== input.reviewRef.toUpperCase()) {
    return { problem: `That is not the current settings review; the current one is ${current}. Read setup again and tell the host what changed.`, saved: false as const };
  }

  const proposal = await computeSetupProposal(deps.db, actor.id);
  if (!proposal || settingsRef(proposal.proposalHash) !== current) {
    return { problem: "The settings changed meanwhile; nothing was saved. Read setup again.", saved: false as const };
  }
  if (!proposal.roles || missingFields(withStatedAnswers(proposal.proposed), proposal.handleAvailability === "available").length > 0) {
    return { missingFields: proposal.missingFields, problem: "Some settings are still missing; nothing was saved.", saved: false as const };
  }

  const [preview] = await deps.db<{ state: string; review_hash: string | null }[]>`
    select state, review_hash from app.imessage_outbox
    where host_account_id = ${actor.id} and binding_id = ${binding.id} and kind = 'image'
    order by created_at desc, id desc limit 1
  `;
  if (preview?.state !== "accepted" || preview.review_hash !== proposal.proposalHash) {
    return { saved: false as const, problem: "This review needs a delivered slot preview. Send preview_next_week and wait for the host to agree to it." };
  }

  let live;
  try {
    live = (await (await openHostCalendar(deps.calendar, actor.id)).listCalendars()).calendars;
  } catch (error) {
    if (error instanceof CalendarAccessError) return { problem: "Google Calendar could not be read. The host reconnects it in the browser.", saved: false as const };
    throw error;
  }

  const retryKey = `tool:${call.callId}`;
  const outcome = await runCommand({ authenticate: async () => actor, db: deps.db }, confirmSettingsCommand(live, deps.appOrigin, { bindingId: binding.id, call }), {
    expectedRevision: proposal.records.draftRevision,
    input: { proposalHash: proposal.proposalHash },
    resourceId: actor.id,
    retryKey,
  });

  if (outcome.ok) {
    // Older Confirm settings buttons on Telegram stop working, as after `confirm <ref>`.
    await deps.db.begin((tx) => enqueueSettingsButtonRetirement(tx, actor.id, retryKey));
    return { links: outcome.result.links, message: "Saved. Repeat only these links to the host.", saved: true as const };
  }
  if (outcome.error.reason === "destination_not_writable") {
    await recordDestinationAccess(deps.db, actor.id, live);
    return { problem: "Bookings can no longer be added to the chosen calendar; the host chooses another in the browser. Nothing was saved.", saved: false as const };
  }
  return {
    problem: outcome.error.category === "stale_revision" ? "The settings changed meanwhile; nothing was saved. Read setup again." : "The settings could not be saved here; the host can save them in the browser.",
    saved: false as const,
  };
}

const calendarChoice = z.object({ index: z.number().int().min(0), name: z.string().min(1) }).strict();
export const setCalendarRolesToolInput = z.object({
  conflictCalendars: z.array(calendarChoice).min(1).max(50),
  bookingCalendar: calendarChoice,
}).strict();

export async function setCalendarRolesForTool(deps: SetupDependencies, call: SetupToolCall, input: z.infer<typeof setCalendarRolesToolInput>) {
  const actor = await authorizeSetupTool(deps.db, call.auth, call.sessionId);
  const channel = await channelOfTurn(deps.db, call.sessionId, actor.id);
  const binding = await activeBindingOfHost(deps.db, actor.id);
  if (!channel || binding?.channel !== channel) return { saved: false, problem: "Calendar roles can be changed only from the linked conversation." };
  let live;
  try {
    live = (await (await openHostCalendar(deps.calendar, actor.id)).listCalendars()).calendars;
  } catch (error) {
    if (error instanceof CalendarAccessError) return { saved: false, problem: "Google Calendar could not be read. Reconnect it in the browser." };
    throw error;
  }
  const resolve = (choice: z.infer<typeof calendarChoice>) => {
    const calendar = live[choice.index];
    return calendar && encodeDisplayName(calendar.summary) === choice.name ? calendar.id : null;
  };
  const conflicts = input.conflictCalendars.map(resolve);
  const booking = resolve(input.bookingCalendar);
  if (!booking || conflicts.some(id => id === null)) return { saved: false, problem: "The calendar list changed. Read setup again and use its quoted names and indices." };
  const command = saveCalendarRolesCommand(live);
  const outcome = await runCommand({ authenticate: async () => actor, db: deps.db }, {
    ...command,
    async run(tx, context) {
      await authorizeSetupTool(tx, call.auth, call.sessionId, { lock: true });
      if (await channelOfTurn(tx, call.sessionId, actor.id) !== channel) throw new CommandError("forbidden");
      const active = await activeBindingOfHost(tx, actor.id);
      if (active?.id !== binding.id) throw new CommandError("forbidden");
      return command.run(tx, context);
    },
  }, {
    expectedRevision: (await readCalendarRoles(deps.db, actor.id))?.revision ?? 0,
    input: { conflictCalendarIds: conflicts.filter((id): id is string => id !== null), bookingCalendarId: booking },
    resourceId: actor.id, retryKey: `tool:${call.callId}`,
  });
  return outcome.ok ? { saved: true, analysisStarted: true } : { saved: false, problem: "The calendars could not be saved. The destination must be writable; read setup again." };
}

export const previewNextWeekToolInput = z
  .object({
    skipNoteReview: z
      .boolean()
      .optional()
      .describe("True only when the host said to skip the note review or do it later; the image is then sent with the note candidates still busy."),
  })
  .strict();

type Proposal = NonNullable<Awaited<ReturnType<typeof computeSetupProposal>>>;

// Next week's open slots for the current draft (host-onboarding-in-chat design 5),
// with the draft's note exclusions and the host's confirmed notes no longer busy
// (calendar-note-review design 8). Throws CalendarAccessError when Google cannot
// be read, so no free time is inferred; returns the missing fields instead when
// the draft cannot be previewed yet.
export async function composeNextWeekPreview(deps: SetupDependencies, db: Queryable, hostAccountId: string, proposal: Proposal, now = new Date()) {
  const fields = withStatedAnswers(proposal.proposed);
  const missing = missingFields(fields, proposal.handleAvailability === "available");
  if (!proposal.roles || missing.length) return { missing, preview: null };
  const timezone = SETUP_FIELD_SCHEMAS.timezone.parse(fields.timezone?.value);
  const mode = SETUP_FIELD_SCHEMAS.meetingMode.parse(fields.meetingMode?.value);
  const location = mode === "online" ? null : SETUP_FIELD_SCHEMAS.location.parse(fields.location?.value);
  const range = nextWeekRange(timezone, now);
  const calendar = await openHostCalendar(deps.calendar, hostAccountId);
  const events = (await Promise.all(proposal.roles.conflictCalendars.map(entry => calendar.listEvents(entry.id, range)))).flat();
  const busy = normalizeBusy(events, {
    timezone, selfEmail: proposal.records.email, endpointKey: text => text,
    noteExclusions: [
      ...SETUP_FIELD_SCHEMAS.noteExclusions.parse(fields.noteExclusions?.value ?? []),
      ...(await slotPreviewNoteExclusions(db, hostAccountId)),
    ],
  });
  const preview = computeSlotPreview({
    timezone, meetingMode: mode,
    place: location === null ? null : location.kind === "decide_per_meeting" ? "Decide per meeting" : [...location.areas, location.venue].filter(Boolean).join(", "),
    travelMode: mode === "online" ? null : SETUP_FIELD_SCHEMAS.travelMode.parse(fields.travelMode?.value),
    durationMinutes: SETUP_FIELD_SCHEMAS.durationMinutes.parse(fields.durationMinutes?.value),
    weeklyWindows: SETUP_FIELD_SCHEMAS.weeklyWindows.parse(fields.weeklyWindows?.value),
    bufferBeforeMinutes: SETUP_FIELD_SCHEMAS.bufferBeforeMinutes.parse(fields.bufferBeforeMinutes?.value),
    bufferAfterMinutes: SETUP_FIELD_SCHEMAS.bufferAfterMinutes.parse(fields.bufferAfterMinutes?.value),
    reviewRef: settingsRef(proposal.proposalHash),
  }, busy, now);
  return { missing, preview };
}

function openRanges(preview: SlotPreview) {
  return preview.days.map(day => `${day.date}: ${day.open.map(range => `${range.start}–${range.end}`).join(", ") || "—"}`).join("\n");
}

// The note candidates the chat onboarding asks about: the unanswered items of a
// completed scan, for a host who has not confirmed settings yet.
async function onboardingNoteCandidates(db: Queryable, hostAccountId: string) {
  const [settings] = await db`select 1 from app.host_settings where host_account_id = ${hostAccountId}`;
  if (settings) return 0;
  const review = await readNoteReview(db, hostAccountId);
  return review.state === "ready" ? review.items.filter(item => item.decision === null).length : 0;
}

export async function previewNextWeekForTool(deps: SetupDependencies, call: SetupToolCall, input: z.infer<typeof previewNextWeekToolInput> = {}) {
  const actor = await authorizeSetupTool(deps.db, call.auth, call.sessionId);
  const channel = await channelOfTurn(deps.db, call.sessionId, actor.id);
  const binding = await activeBindingOfHost(deps.db, actor.id);
  if (!channel || binding?.channel !== channel) return { queued: false, problem: "A preview can be sent only from the linked conversation." };
  const proposal = await computeSetupProposal(deps.db, actor.id);
  if (!proposal?.roles) return { queued: false, problem: "Choose calendars first." };
  const missing = missingFields(withStatedAnswers(proposal.proposed), proposal.handleAvailability === "available");
  if (missing.length) return { queued: false, missingFields: missing, problem: "Record the missing host answers before the preview." };
  const skip = input.skipNoteReview === true;
  const language = await hostConversationLanguage(deps.db, actor.id);

  // The note step (calendar-note-review design 8): the review link goes first,
  // once per linked chat, and the image follows the review's 확인.
  const step = await noteStepOf(deps.db, binding.id);
  if (step?.waiting && !skip) {
    return {
      queued: false, waitingForNoteReview: true,
      problem: "The note review link was sent; the slot image follows by itself once the host presses 확인 on that page. Only if the host says to skip it or do it later, call preview_next_week with skipNoteReview true.",
    };
  }
  const candidates = !step && !skip ? await onboardingNoteCandidates(deps.db, actor.id) : 0;
  if (candidates > 0) {
    const sent = await runCommand({ authenticate: async () => actor, db: deps.db }, {
      operation: "setup.send_note_review",
      input: z.object({ proposalHash: z.string() }).strict(),
      async run(tx, context) {
        await authorizeSetupTool(tx, call.auth, call.sessionId, { lock: true });
        if (await channelOfTurn(tx, call.sessionId, actor.id) !== channel) throw new CommandError("forbidden");
        const active = await activeBindingOfHost(tx, actor.id);
        if (active?.id !== binding.id) throw new CommandError("stale_revision");
        await recordOutbound(tx, {
          kind: "notice", dedupeKey: noteReviewLinkKey(binding.id), hostAccountId: actor.id, bindingId: binding.id,
          recipient: bindingRecipient(deps.calendar.tokenKeys, binding), recipientHash: binding.sender_hash, tokenKey: deps.calendar.tokenKeys[0]!,
          text: channelReplies(language).onboarding.noteReviewLink(candidates, `${deps.appOrigin}/app/notes`),
        });
        return { proposalHash: context.input.proposalHash };
      },
    }, { input: { proposalHash: proposal.proposalHash }, resourceId: actor.id, retryKey: `tool:${call.callId}` });
    if (!sent.ok) return { queued: false, problem: "The conversation changed. Read setup again." };
    return {
      queued: false, noteReviewSent: true,
      note: "The service sent the host the note review link. The slot image follows by itself once the host presses 확인 there, with the notes they free no longer busy. Do not list times or ask about notes, and call preview_next_week again only if the host says to skip the review or changes a setting. Say in one line what you recorded.",
    };
  }

  let composed;
  try {
    composed = await composeNextWeekPreview(deps, deps.db, actor.id, proposal);
  } catch (error) {
    if (error instanceof CalendarAccessError) return { queued: false, problem: "Google Calendar could not be read; no free times were inferred." };
    throw error;
  }
  const preview = composed.preview;
  if (!preview) return { queued: false, missingFields: composed.missing, problem: "Record the missing host answers before the preview." };
  const outcome = await runCommand({ authenticate: async () => actor, db: deps.db }, {
    operation: "setup.preview_next_week",
    input: z.object({ proposalHash: z.string() }).strict(),
    async run(tx, context) {
      await authorizeSetupTool(tx, call.auth, call.sessionId, { lock: true });
      if (await channelOfTurn(tx, call.sessionId, actor.id) !== channel) throw new CommandError("forbidden");
      await lockCalendarRoles(tx, actor.id);
      await lockDraft(tx, actor.id);
      const current = await computeSetupProposal(tx, actor.id);
      const active = await activeBindingOfHost(tx, actor.id);
      if (active?.id !== binding.id || current?.proposalHash !== context.input.proposalHash) throw new CommandError("stale_revision");
      await recordOutbound(tx, {
        kind: "image", image: { preview, language }, reviewHash: current.proposalHash,
        dedupeKey: `slot-preview:${binding.id}:${call.callId}`, hostAccountId: actor.id, bindingId: binding.id,
        recipient: bindingRecipient(deps.calendar.tokenKeys, binding), recipientHash: binding.sender_hash, tokenKey: deps.calendar.tokenKeys[0]!,
      });
      return { queued: true, reviewRef: preview.reviewRef, ranges: openRanges(preview) };
    },
  }, { input: { proposalHash: proposal.proposalHash }, resourceId: actor.id, retryKey: `tool:${call.callId}` });
  return outcome.ok ? outcome.result : { queued: false, problem: "The settings changed. Read setup again before sending a new preview." };
}

// The job the review's 확인 publishes (calendar-note-review design 8): it sends
// the slot image for the current draft, once, to the chat that got the review
// link. A binding that changed, a step that no longer waits (the host skipped in
// words and the image went out) or a draft that cannot be previewed sends
// nothing. A draft that changed while Google was read, or Google being
// unavailable, retries.
class SlotImageRetry extends Error {}

export function createOnboardingSlotImageHandler(load: () => SetupDependencies = setupDependenciesFromEnvironment): JobHandler {
  return async (tx: Transaction, job: ClaimedJob) => {
    const hostAccountId = typeof job.payload.hostAccountId === "string" ? job.payload.hostAccountId : null;
    const linkId = typeof job.payload.linkId === "string" ? job.payload.linkId : null;
    const bindingId = typeof job.payload.bindingId === "string" ? job.payload.bindingId : null;
    if (!hostAccountId || !linkId || !bindingId) return { skipped: true };
    const binding = await activeBindingOfHost(tx, hostAccountId);
    if (binding?.id !== bindingId) return { skipped: true };
    const step = await noteStepOf(tx, binding.id);
    if (step?.linkId !== linkId || !step.waiting) return { skipped: true };

    const deps = load();
    const proposal = await computeSetupProposal(tx, hostAccountId);
    if (!proposal) return { skipped: true };
    let composed;
    try {
      composed = await composeNextWeekPreview({ ...deps, calendar: { ...deps.calendar, db: tx } }, tx, hostAccountId, proposal);
    } catch (error) {
      if (error instanceof CalendarAccessError && error.category !== "calendar_unavailable") return { skipped: true, problem: error.category };
      if (error instanceof CalendarAccessError) throw new SlotImageRetry("Google Calendar could not be read", { cause: error });
      throw error;
    }
    if (!composed.preview) return { skipped: true, missingFields: composed.missing };

    await lockCalendarRoles(tx, hostAccountId);
    await lockDraft(tx, hostAccountId);
    const current = await computeSetupProposal(tx, hostAccountId);
    if (current?.proposalHash !== proposal.proposalHash) throw new SlotImageRetry("The draft changed while the preview was computed");
    const language = await hostConversationLanguage(tx, hostAccountId);
    await recordOutbound(tx, {
      kind: "image", image: { preview: composed.preview, language }, reviewHash: proposal.proposalHash,
      dedupeKey: `slot-preview:${binding.id}:notes:${linkId}`, hostAccountId, bindingId: binding.id,
      recipient: bindingRecipient(deps.calendar.tokenKeys, binding), recipientHash: binding.sender_hash, tokenKey: deps.calendar.tokenKeys[0]!,
    });
    return { queued: true, reviewRef: composed.preview.reviewRef };
  };
}
