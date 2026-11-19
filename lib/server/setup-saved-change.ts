import { recordDestinationAccess } from "./calendar-roles";
import { channelOfTurn } from "./channel-selection";
import { type Actor, runCommand } from "./commands";
import { CalendarAccessError, openHostCalendar } from "./google-calendar";
import { computeSetupProposal, differsFromConfirmed, missingFields, withStatedAnswers, type SetupDependencies } from "./setup";
import { confirmSettingsCommand } from "./setup-commands";
import type { SetupToolCall } from "./setup-tools";

// What happened to a change of a host whose settings are already confirmed:
// "saved" (guests see it now), "not_ready" (first-time setup, which the host
// saves themselves), "unchanged" (nothing differs from the saved settings), or
// why it could not be saved yet.
export type SavedChangeOutcome =
  | "saved"
  | "not_ready"
  | "unchanged"
  | "incomplete"
  | "calendar_unavailable"
  | "destination_not_writable"
  | "not_saved";

// Saves a ready host's recorded change at once, so the hours, place and other
// settings the host changes are the ones guests book against without a second
// approval. Runs after the change itself was written; first-time setup is left
// to the host's own save.
export async function saveReadyHostChange(
  deps: SetupDependencies,
  actor: Actor,
  options: { readonly retryKey: string; readonly call?: SetupToolCall },
): Promise<SavedChangeOutcome> {
  const proposal = await computeSetupProposal(deps.db, actor.id);
  const confirmed = proposal?.records.confirmed;
  if (!proposal || !confirmed) return "not_ready";
  if (!proposal.roles) return "incomplete";
  if (!differsFromConfirmed(proposal.proposed, proposal.roles, confirmed)) return "unchanged";

  // Stated mode, place and travel mode count as answers only in the host's
  // linked conversation; on the web they still need the card press.
  const acceptStated = options.call ? (await channelOfTurn(deps.db, options.call.sessionId, actor.id)) !== null : false;
  const fields = acceptStated ? withStatedAnswers(proposal.proposed) : proposal.proposed;
  if (missingFields(fields, proposal.handleAvailability === "available").length > 0) return "incomplete";

  let live;
  try {
    live = (await (await openHostCalendar(deps.calendar, actor.id)).listCalendars()).calendars;
  } catch (error) {
    if (error instanceof CalendarAccessError) return "calendar_unavailable";
    throw error;
  }

  const outcome = await runCommand(
    { authenticate: async () => actor, db: deps.db },
    confirmSettingsCommand(live, deps.appOrigin, undefined, { acceptStated, ...(options.call ? { call: options.call } : {}) }),
    {
      expectedRevision: proposal.records.draftRevision,
      input: { proposalHash: proposal.proposalHash },
      resourceId: actor.id,
      retryKey: options.retryKey,
    },
  );

  if (outcome.ok) return "saved";
  if (outcome.error.reason === "destination_not_writable") {
    await recordDestinationAccess(deps.db, actor.id, live);
    return "destination_not_writable";
  }
  return "not_saved";
}
