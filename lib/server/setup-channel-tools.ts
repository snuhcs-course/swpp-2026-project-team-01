import { z } from "zod";
import { recordDestinationAccess } from "./calendar-roles";
import { channelOfTurn } from "./channel-selection";
import { runCommand } from "./commands";
import { CalendarAccessError, openHostCalendar } from "./google-calendar";
import { hostRequestsForModel, QUOTED_NOTE, SELECT_NOTE } from "./host-review-tools";
import { listHostRequests } from "./host-requests";
import { settingsRef } from "./request-ref";
import { computeSetupProposal, readSetupState, type SetupDependencies } from "./setup";
import { confirmSettingsCommand } from "./setup-commands";
import { authorizeSetupTool, type SetupToolCall } from "./setup-tools";
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
  if (!(await channelOfTurn(deps.db, call.sessionId, actor.id))) {
    return { problem: "Saving in words works only from the host's linked iMessage, WhatsApp or Telegram. On the web, the host presses Confirm and save proposed settings.", saved: false as const };
  }

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
  if (!proposal.roles || proposal.missingFields.length > 0) {
    return { missingFields: proposal.missingFields, problem: "Some settings are still missing; nothing was saved.", saved: false as const };
  }

  let live;
  try {
    live = (await (await openHostCalendar(deps.calendar, actor.id)).listCalendars()).calendars;
  } catch (error) {
    if (error instanceof CalendarAccessError) return { problem: "Google Calendar could not be read. The host reconnects it in the browser.", saved: false as const };
    throw error;
  }

  const retryKey = `tool:${call.callId}`;
  const outcome = await runCommand({ authenticate: async () => actor, db: deps.db }, confirmSettingsCommand(live, deps.appOrigin), {
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
