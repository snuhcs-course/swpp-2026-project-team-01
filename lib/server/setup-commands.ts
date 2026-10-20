import { z } from "zod";
import {
  type CalendarRef,
  type ConfirmedSettings,
  type DraftEntry,
  SETUP_FIELD_NAMES,
  SETUP_FIELD_SCHEMAS,
  type SetupFieldName,
  type ValueSource,
} from "../contracts/setup";
import { lockActiveHost, lockCalendarRoles, lockDraft, writeDraft } from "./analysis";
import { isWritable } from "./calendar-roles";
import { assertRevision, canonicalJson, type CommandDefinition, CommandError } from "./commands";
import type { Transaction } from "./database";
import type { CalendarListEntry } from "./google-calendar";
import { assignHandle, checkHandle, HandleError } from "./handles";
import { acceptedEntry, computeSetupProposal, proposalValues, type SetupLinks, setupLinks } from "./setup";

// The draft and confirmation commands of host setup (design decisions 10 to 12).
// Each runs through runCommand: the actor comes from verified credentials, the
// expected revision is the draft revision the caller last saw, and every write
// rechecks that the account is active under its share lock. Locks follow setup's
// order (see lockCalendarRoles). Proposals come from durable records only, so no
// command takes the browser's zone.

const fieldName = z.enum(SETUP_FIELD_NAMES as [SetupFieldName, ...SetupFieldName[]]);

// A handle may be drafted only when the host could take it now.
export async function assertHandleAvailable(tx: Transaction, hostAccountId: string, handle: string) {
  if ((await checkHandle(tx, hostAccountId, handle)).availability !== "available") {
    throw new CommandError("invalid_input");
  }
}

const updateDraftInput = z
  .object({
    field: fieldName,
    action: z.enum(["use_suggestion", "adjust", "choose_own"]),
    value: z.unknown().optional(),
    // Use this: the value the card showed, which must still be the proposed one.
    shown: z.unknown().optional(),
  })
  .strict()
  .refine((input) => (input.action === "use_suggestion") === (input.value === undefined), {
    message: "Use this takes no value; Adjust and Choose my own take one.",
  })
  .refine((input) => (input.action === "use_suggestion") === (input.shown !== undefined), {
    message: "Use this names the value the card showed; Adjust and Choose my own do not.",
  });

export type UpdateDraftInput = z.infer<typeof updateDraftInput>;

// setup.update_draft: every action stamps the answer with acceptedAt and keeps
// a replaced answer in the field's history (see acceptedEntry). **Use this** accepts the field's current proposed value
// (a suggestion, or a value the assistant drafted, such as a "You said" answer)
// with its label and evidence. The value itself comes from the server; `shown`
// only proves the card showed that value, and a different current value is a
// stale card. **Adjust** and **Choose my own** write the host's own value as
// stated and accepted.
export const updateDraftCommand: CommandDefinition<UpdateDraftInput, { revision: number }> = {
  input: updateDraftInput,
  operation: "setup.update_draft",
  async run(tx, context) {
    const hostAccountId = context.actor.id;
    const { field, action } = context.input;
    await lockActiveHost(tx, hostAccountId);
    const draft = await lockDraft(tx, hostAccountId);
    assertRevision(draft.revision, context.expectedRevision);
    const existing = draft.fields[field] as DraftEntry | undefined;
    // The answer's time, kept in the draft for its receipt in the conversation.
    const acceptedAt = new Date().toISOString();
    let entry: DraftEntry;

    if (action === "use_suggestion") {
      const proposal = await computeSetupProposal(tx, hostAccountId);
      const proposed = proposal?.fields[field].proposed;

      if (!proposed) throw new CommandError("invalid_input");
      if (canonicalJson(proposed.value) !== canonicalJson(context.input.shown)) throw new CommandError("stale_revision");

      entry = acceptedEntry(
        existing,
        { reason: proposed.reason, sampleSize: proposed.sampleSize, source: proposed.source, value: proposed.value } as DraftEntry,
        acceptedAt,
      );
    } else {
      const parsed = SETUP_FIELD_SCHEMAS[field].safeParse(context.input.value);

      if (!parsed.success) throw new CommandError("invalid_input");

      entry = acceptedEntry(existing, { source: "stated", value: parsed.data } as DraftEntry, acceptedAt);
    }

    if (field === "handle") await assertHandleAvailable(tx, hostAccountId, entry.value as string);

    const revision = await writeDraft(tx, hostAccountId, { ...draft.fields, [field]: entry });
    return { revision };
  },
};

const confirmInput = z.object({ proposalHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

export type ConfirmSettingsResult = { readonly handle: string; readonly links: SetupLinks };

function toRef(calendar: CalendarRef): CalendarRef {
  return {
    accessRole: calendar.accessRole,
    id: calendar.id,
    summary: calendar.summary,
    ...(calendar.primary ? { primary: true } : {}),
  };
}

// setup.confirm_settings (design decision 12). `live` is the calendar list read
// just before the command, and `appOrigin` the origin the links are built on. In
// one transaction it share-locks the active account, locks the roles and then the
// draft (setup's lock order, which saving roles shares) and checks the reviewed
// revision, recomputes the proposal and compares the reviewed hash, checks that
// the proposal's booking destination is still writable (refusing with the
// destination_not_writable reason otherwise), validates every required value,
// assigns the handle and writes the confirmed settings. Any failure rolls all of
// it back.
export function confirmSettingsCommand(
  live: readonly CalendarListEntry[],
  appOrigin: string,
): CommandDefinition<z.infer<typeof confirmInput>, ConfirmSettingsResult> {
  const byId = new Map(live.map((calendar) => [calendar.id, calendar]));

  return {
    input: confirmInput,
    operation: "setup.confirm_settings",
    async run(tx, context) {
      const hostAccountId = context.actor.id;
      await lockActiveHost(tx, hostAccountId);
      await lockCalendarRoles(tx, hostAccountId);
      const draft = await lockDraft(tx, hostAccountId);
      assertRevision(draft.revision, context.expectedRevision);
      const proposal = await computeSetupProposal(tx, hostAccountId);

      if (!proposal || proposal.proposalHash !== context.input.proposalHash) {
        throw new CommandError("stale_revision");
      }

      // The roles the reviewed hash covers, read under the roles lock.
      const roles = proposal.roles;

      if (!roles || proposal.missingFields.length > 0) throw new CommandError("invalid_input");

      const destination = byId.get(roles.bookingCalendar.id);

      if (!destination || !isWritable(destination)) {
        throw new CommandError("invalid_input", { reason: "destination_not_writable" });
      }

      const values = proposalValues(proposal.proposed);
      const parsed: Partial<Record<SetupFieldName, unknown>> = {};
      const provenance: Partial<Record<SetupFieldName, ValueSource>> = {};

      for (const [field, entry] of Object.entries(values) as [SetupFieldName, { value: unknown; source: ValueSource }][]) {
        const result = SETUP_FIELD_SCHEMAS[field].safeParse(entry.value);
        if (!result.success) throw new CommandError("invalid_input");
        parsed[field] = result.data;
        provenance[field] = entry.source;
      }

      let handle: string;

      try {
        handle = (await assignHandle(tx, hostAccountId, parsed.handle as string)).handle;
      } catch (error) {
        if (error instanceof HandleError) throw new CommandError("invalid_input", { cause: error });
        throw error;
      }

      const verifiedAt = new Date().toISOString();
      const settings = {
        bookingCalendar: { ...toRef(destination), verifiedAt },
        bufferAfterMinutes: parsed.bufferAfterMinutes,
        bufferBeforeMinutes: parsed.bufferBeforeMinutes,
        conflictCalendars: roles.conflictCalendars.map(toRef),
        displayName: parsed.displayName,
        durationMinutes: parsed.durationMinutes,
        handle,
        // An online-only policy saves no location or transport.
        location: parsed.location ?? null,
        meetingMode: parsed.meetingMode,
        noteExclusions: parsed.noteExclusions ?? [],
        provenance,
        timezone: parsed.timezone,
        travelBufferMinutes: parsed.travelBufferMinutes ?? null,
        travelMode: parsed.travelMode ?? null,
        weeklyLimit: parsed.weeklyLimit ?? null,
        weeklyWindows: parsed.weeklyWindows,
      } as unknown as ConfirmedSettings;

      await tx`
        insert into app.host_settings as stored (host_account_id, settings, draft_revision)
        values (${hostAccountId}, ${tx.json(settings as unknown as Parameters<typeof tx.json>[0])}, ${draft.revision})
        on conflict (host_account_id) do update set
          settings = excluded.settings, draft_revision = excluded.draft_revision,
          revision = stored.revision + 1, confirmed_at = now(), updated_at = now()
      `;
      // The live list just showed the destination writable. updated_at stays the
      // host's last save of the roles, which their receipt shows.
      await tx`
        update app.calendar_roles set destination_verified_at = now()
        where host_account_id = ${hostAccountId} and booking_calendar ->> 'id' = ${destination.id}
      `;

      return { handle, links: setupLinks(appOrigin, handle) };
    },
  };
}
