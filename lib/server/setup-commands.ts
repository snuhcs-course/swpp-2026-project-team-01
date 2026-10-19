import { z } from "zod";
import {
  type CalendarRef,
  type ConfirmedSettings,
  type DraftEntry,
  type DraftFields,
  isValidTimeZone,
  SETUP_FIELD_NAMES,
  SETUP_FIELD_SCHEMAS,
  type SetupFieldName,
  type ValueSource,
} from "../contracts/setup";
import { lockActiveHost } from "./analysis";
import { isWritable, readCalendarRoles } from "./calendar-roles";
import { assertRevision, type CommandDefinition, CommandError } from "./commands";
import type { Transaction } from "./database";
import type { CalendarListEntry } from "./google-calendar";
import { assignHandle, checkHandle, HandleError } from "./handles";
import { computeSetupProposal, proposalValues, type SetupLinks, setupLinks } from "./setup";

// The draft and confirmation commands of host setup (design decisions 10 to 12).
// Each runs through runCommand: the actor comes from verified credentials, the
// expected revision is the draft revision the caller last saw, and every write
// rechecks that the account is active under its share lock.

const fieldName = z.enum(SETUP_FIELD_NAMES as [SetupFieldName, ...SetupFieldName[]]);
const browserTimeZone = z.string().max(64).refine(isValidTimeZone).optional();

// Locks the host's draft row. With no row yet the revision is 0, so a first
// write expects 0 and creates revision 1.
export async function lockDraft(tx: Transaction, hostAccountId: string) {
  // Serializes the first write, which has no row to lock.
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.setup_drafts:${hostAccountId}`}, 0))`;
  const [row] = await tx<{ fields: DraftFields; revision: number }[]>`
    select revision, fields from app.setup_drafts where host_account_id = ${hostAccountId} for update
  `;
  return { fields: row?.fields ?? {}, revision: row?.revision ?? 0 };
}

// Writes the draft's fields as the next revision.
export async function writeDraft(tx: Transaction, hostAccountId: string, fields: DraftFields) {
  const [saved] = await tx<{ revision: number }[]>`
    insert into app.setup_drafts as stored (host_account_id, fields)
    values (${hostAccountId}, ${tx.json(fields as Parameters<typeof tx.json>[0])})
    on conflict (host_account_id) do update set
      fields = excluded.fields, revision = stored.revision + 1, updated_at = now()
    returning revision
  `;
  return saved!.revision;
}

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
    browserTimeZone,
  })
  .strict()
  .refine((input) => (input.action === "use_suggestion") === (input.value === undefined), {
    message: "Use this takes no value; Adjust and Choose my own take one.",
  });

export type UpdateDraftInput = z.infer<typeof updateDraftInput>;

// setup.update_draft: **Use this** copies the field's current suggestion, with its
// label and evidence, into the draft as accepted (the value never comes from the
// client); **Adjust** and **Choose my own** write the host's own value as stated
// and accepted.
export const updateDraftCommand: CommandDefinition<UpdateDraftInput, { revision: number }> = {
  input: updateDraftInput,
  operation: "setup.update_draft",
  async run(tx, context) {
    const hostAccountId = context.actor.id;
    const { field, action } = context.input;
    await lockActiveHost(tx, hostAccountId);
    const draft = await lockDraft(tx, hostAccountId);
    assertRevision(draft.revision, context.expectedRevision);
    let entry: DraftEntry;

    if (action === "use_suggestion") {
      const proposal = await computeSetupProposal(tx, hostAccountId, { browserTimeZone: context.input.browserTimeZone });
      const suggestion = proposal?.fields[field].suggestion;

      if (!suggestion) throw new CommandError("invalid_input");

      entry = {
        accepted: true,
        reason: suggestion.reason,
        sampleSize: suggestion.sampleSize,
        source: suggestion.source,
        value: suggestion.value,
      } as DraftEntry;
    } else {
      const parsed = SETUP_FIELD_SCHEMAS[field].safeParse(context.input.value);

      if (!parsed.success) throw new CommandError("invalid_input");

      entry = { accepted: true, source: "stated", value: parsed.data } as DraftEntry;
    }

    if (field === "handle") await assertHandleAvailable(tx, hostAccountId, entry.value as string);

    const revision = await writeDraft(tx, hostAccountId, { ...draft.fields, [field]: entry });
    return { revision };
  },
};

const confirmInput = z.object({ proposalHash: z.string().regex(/^[0-9a-f]{64}$/), browserTimeZone }).strict();

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
// one transaction it share-locks the active account, locks the draft and checks
// the reviewed revision, recomputes the proposal and compares the reviewed hash,
// checks that the saved booking destination is still writable, validates every
// required value, assigns the handle and writes the confirmed settings. Any
// failure rolls all of it back.
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
      const draft = await lockDraft(tx, hostAccountId);
      assertRevision(draft.revision, context.expectedRevision);
      const proposal = await computeSetupProposal(tx, hostAccountId, { browserTimeZone: context.input.browserTimeZone });

      if (!proposal || proposal.proposalHash !== context.input.proposalHash) {
        throw new CommandError("stale_revision");
      }

      const roles = await readCalendarRoles(tx, hostAccountId);
      const destination = roles ? byId.get(roles.bookingCalendar.id) : undefined;

      if (!roles || !destination || !isWritable(destination) || proposal.missingFields.length > 0) {
        throw new CommandError("invalid_input");
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
      // The live list just showed the destination writable.
      await tx`
        update app.calendar_roles set destination_verified_at = now(), updated_at = now()
        where host_account_id = ${hostAccountId} and booking_calendar ->> 'id' = ${destination.id}
      `;

      return { handle, links: setupLinks(appOrigin, handle) };
    },
  };
}
