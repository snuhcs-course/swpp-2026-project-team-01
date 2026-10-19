import { createHash } from "node:crypto";
import type { AnalysisCard, PlaceHint } from "../contracts/analysis";
import {
  type ConfirmedSettings,
  type DraftEntry,
  type DraftFields,
  HOST_ANSWER_FIELDS,
  IN_PERSON_FIELDS,
  isValidTimeZone,
  type MeetingMode,
  OPTIONAL_FIELDS,
  requiredFields,
  SETUP_FIELD_NAMES,
  SETUP_FIELD_SCHEMAS,
  type SetupFieldName,
  type SetupFieldValue,
  type SetupNextAction,
  STARTER_DEFAULTS,
  type ValueSource,
} from "../contracts/setup";
import {
  lockDraft,
  placeHintFromEvidence,
  readLatestAnalysis,
  type SetupSuggestions,
  suggestFromEvidence,
  windowsInOtherZone,
  writeDraft,
} from "./analysis";
import {
  isWritable,
  readCalendarRoles,
  recheckConfirmedDestination,
  recommendCalendarRoles,
  type SavedCalendarRoles,
} from "./calendar-roles";
import { canonicalJson } from "./commands";
import { type Database, database, type Queryable } from "./database";
import {
  CalendarAccessError,
  type CalendarAccessCategory,
  type CalendarListEntry,
  type GoogleCalendarDependencies,
  googleCalendarConfigFromEnvironment,
  openHostCalendar,
} from "./google-calendar";
import { checkHandle, currentHandle, type HandleAvailability, proposeHandle } from "./handles";
import { calendarUsable, readReadiness } from "./readiness";
import { appOriginFromEnvironment } from "./same-origin";
import { tokenKeyFromEnvironment } from "./token-encryption";

// The host setup read model (host-setup: server-derived setup progress). Every
// read derives the next action, the proposed values and readiness from durable
// records: the Calendar grant, calendar roles, the latest analysis, the draft and
// the confirmed settings. Nothing here trusts the browser or the model for the
// step. A read writes only twice (design decision 2): the best-effort destination
// recheck for a ready host, and, once, the browser's zone as the timezone starter
// default, so later proposals never depend on what a request says.

export type SetupDependencies = {
  readonly db: Database;
  // The canonical origin (APP_ORIGIN) that booking and skill links are built on.
  readonly appOrigin: string;
  readonly calendar: GoogleCalendarDependencies;
};

export function setupDependenciesFromEnvironment(): SetupDependencies {
  const db = database();
  return {
    appOrigin: appOriginFromEnvironment(),
    calendar: { config: googleCalendarConfigFromEnvironment(), db, tokenKeys: [tokenKeyFromEnvironment()] },
    db,
  };
}

// A value offered for a field: a suggestion from evidence or a starter default,
// or the draft's or the confirmed settings' value.
export type FieldSuggestion<F extends SetupFieldName = SetupFieldName> = {
  readonly value: SetupFieldValue<F>;
  readonly source: ValueSource;
  readonly sampleSize: number | null;
  readonly reason: string | null;
};

// The value confirmation would save for a field, and whether the host chose it.
export type ProposedField<F extends SetupFieldName = SetupFieldName> = FieldSuggestion<F> & {
  readonly accepted: boolean;
};

export type SetupFieldView<F extends SetupFieldName = SetupFieldName> = {
  readonly draft: DraftEntry<F> | null;
  readonly suggestion: FieldSuggestion<F> | null;
  readonly proposed: ProposedField<F> | null;
};

export type SetupFieldViews = { readonly [F in SetupFieldName]: SetupFieldView<F> };
export type ProposedFields = { readonly [F in SetupFieldName]?: ProposedField<F> | null };

export type SetupLinks = { readonly booking: string; readonly skill: string };

export type SetupStateView = {
  readonly nextAction: SetupNextAction;
  readonly account: { readonly googleEmail: string | null };
  readonly calendar: {
    readonly connected: boolean;
    readonly invalid: boolean;
    // The live calendar list, read only while choosing calendars or reviewing roles.
    readonly calendars: readonly CalendarListEntry[] | null;
    readonly recommendations: ReturnType<typeof recommendCalendarRoles> | null;
    readonly error: CalendarAccessCategory | null;
    // The saved or confirmed booking destination can no longer take events, so the
    // host must choose a writable one.
    readonly destinationLost: boolean;
  };
  readonly roles: SavedCalendarRoles | null;
  readonly analysis: AnalysisCard | null;
  readonly analysisSkipped: boolean;
  readonly draft: { readonly revision: number };
  readonly fields: SetupFieldViews;
  readonly placeHint: PlaceHint | null;
  readonly missingFields: readonly SetupFieldName[];
  readonly proposalHash: string;
  readonly handleAvailability: HandleAvailability | null;
  readonly readiness: { readonly ready: boolean; readonly handle: string | null; readonly displayName: string | null };
  readonly links: SetupLinks | null;
  // A ready host's proposal differs from the confirmed settings it is public on.
  readonly pendingChanges: boolean;
};

export type SetupReadOptions = {
  // The browser's IANA zone. The first read that brings one stores it as the
  // timezone starter default; it is ignored once the draft has a timezone.
  readonly browserTimeZone?: string | null;
  // Read the live calendar list even outside the calendar step (reviewing roles).
  readonly includeCalendars?: boolean;
};

// ---------------------------------------------------------------------------
// Pure derivations

export type NextActionInput = {
  readonly ready: boolean;
  readonly calendarConnected: boolean;
  readonly hasRoles: boolean;
  readonly destinationLost: boolean;
  readonly analysisPending: boolean;
  readonly analysisSkipped: boolean;
  readonly missingCount: number;
};

// Design decision 2: the first unmet condition, in order, is the next action.
export function deriveNextAction(input: NextActionInput): SetupNextAction {
  if (input.ready) return "ready";
  if (!input.calendarConnected) return "connect_calendar";
  if (!input.hasRoles || input.destinationLost) return "choose_calendars";
  if (input.analysisPending && !input.analysisSkipped) return "analyzing";
  return input.missingCount > 0 ? "review_suggestions" : "confirm_settings";
}

// Mode, location and transport count only as the host's own answers, accepted on
// a card. A value the assistant drafted as stated is shown on its card as "You
// said" with Use this, and counts once the host presses it: conversation text can
// be steered by content the host pasted or the model read, a card press cannot.
export function countsAsHostAnswer(entry: Pick<ProposedField, "accepted">) {
  return entry.accepted;
}

type RolesDestination = Pick<SavedCalendarRoles, "bookingCalendar" | "destinationVerifiedAt">;

// Whether the booking destination is lost: the saved roles' destination is not
// writable (a confirmation found it read-only or gone), or the confirmed one was
// marked unwritable by the recheck and the roles still name it without a save since.
export function destinationLost(roles: RolesDestination | null, confirmed: ConfirmedSettings | null) {
  if (!roles) return false;
  if (!isWritable(roles.bookingCalendar)) return true;

  const unwritableAt = confirmed?.bookingCalendar.unwritableAt;
  return (
    !!unwritableAt &&
    confirmed!.bookingCalendar.id === roles.bookingCalendar.id &&
    Date.parse(roles.destinationVerifiedAt) <= Date.parse(unwritableAt)
  );
}

function answeredMode(proposed: ProposedFields): MeetingMode | undefined {
  const mode = proposed.meetingMode;
  return mode && countsAsHostAnswer(mode) && SETUP_FIELD_SCHEMAS.meetingMode.safeParse(mode.value).success
    ? mode.value
    : undefined;
}

// Required fields still lacking a usable value. Host-answer fields need the
// host's answer; the others need a valid proposed value, which confirmation saves.
export function missingFields(proposed: ProposedFields, handleAvailable: boolean): SetupFieldName[] {
  return requiredFields(answeredMode(proposed)).filter((field) => {
    const entry = proposed[field];

    if (!entry) return true;
    if (HOST_ANSWER_FIELDS.includes(field) && !countsAsHostAnswer(entry)) return true;
    if (!SETUP_FIELD_SCHEMAS[field].safeParse(entry.value).success) return true;
    return field === "handle" && !handleAvailable;
  });
}

// The values and sources confirmation would save: the required fields for the
// answered mode plus the optional ones, so an online-only host saves no location
// or transport.
export function proposalValues(proposed: ProposedFields) {
  const fields = [...requiredFields(answeredMode(proposed)), ...OPTIONAL_FIELDS];
  const values: Partial<Record<SetupFieldName, { value: unknown; source: ValueSource }>> = {};

  for (const field of fields) {
    const entry = proposed[field];
    if (entry) values[field] = { source: entry.source, value: entry.value };
  }

  return values;
}

type RolesForHash = Pick<SavedCalendarRoles, "bookingCalendar" | "conflictCalendars"> | null;

function rolesIdentity(roles: RolesForHash) {
  return roles
    ? { booking: roles.bookingCalendar.id, conflict: roles.conflictCalendars.map((calendar) => calendar.id) }
    : null;
}

// What a review card shows and confirmation saves, hashed: a confirmation whose
// hash differs from a fresh recomputation is reviewing something else.
export function proposalHash(proposed: ProposedFields, roles: RolesForHash) {
  return createHash("sha256")
    .update(canonicalJson({ roles: rolesIdentity(roles), values: proposalValues(proposed) }))
    .digest("hex");
}

const BROWSER_ZONE_REASON = "From this browser.";

function starter<F extends SetupFieldName>(value: SetupFieldValue<F>, reason: string): FieldSuggestion<F> {
  return { reason, sampleSize: null, source: "starter_default", value };
}

export type SuggestionInput = {
  readonly evidenceSuggestions: SetupSuggestions | null;
  // The browser zone stored as the draft's timezone starter default.
  readonly starterTimeZone: string | null;
  readonly profileName: string | null;
  readonly email: string | null;
  readonly proposedHandle: string | null;
};

// The current suggestion per field, in the precedence of design decision 5:
// authorized evidence, then labeled starter defaults. Mode, location and
// transport are never suggested.
export function buildSuggestions(input: SuggestionInput): { [F in SetupFieldName]?: FieldSuggestion<F> } {
  const evidence = input.evidenceSuggestions ?? {};
  const local = input.email?.split("@")[0]?.trim() ?? "";
  const timezone: FieldSuggestion<"timezone"> =
    evidence.timezone ??
    (input.starterTimeZone && isValidTimeZone(input.starterTimeZone)
      ? starter<"timezone">(input.starterTimeZone, BROWSER_ZONE_REASON)
      : starter<"timezone">("UTC", "No calendar or browser time zone was available, so this is UTC."));
  const profileName = input.profileName ? SETUP_FIELD_SCHEMAS.displayName.safeParse(input.profileName) : null;
  const localName = local ? SETUP_FIELD_SCHEMAS.displayName.safeParse(local) : null;

  return {
    bufferAfterMinutes:
      evidence.bufferAfterMinutes ?? starter<"bufferAfterMinutes">(STARTER_DEFAULTS.bufferAfterMinutes, "A starter default."),
    bufferBeforeMinutes:
      evidence.bufferBeforeMinutes ?? starter<"bufferBeforeMinutes">(STARTER_DEFAULTS.bufferBeforeMinutes, "A starter default."),
    ...(profileName?.success
      ? { displayName: { reason: "Your Google profile name.", sampleSize: null, source: "inferred" as const, value: profileName.data } }
      : localName?.success
        ? { displayName: starter<"displayName">(localName.data, "The first part of your Google address.") }
        : {}),
    durationMinutes:
      evidence.durationMinutes ?? starter<"durationMinutes">(STARTER_DEFAULTS.durationMinutes, "A starter default."),
    ...(input.proposedHandle
      ? { handle: starter<"handle">(input.proposedHandle, "Made from your Google address.") }
      : {}),
    noteExclusions:
      evidence.noteExclusions ?? starter<"noteExclusions">(STARTER_DEFAULTS.noteExclusions, "Nothing is excluded until you choose."),
    timezone,
    travelBufferMinutes:
      evidence.travelBufferMinutes ?? starter<"travelBufferMinutes">(STARTER_DEFAULTS.travelBufferMinutes, "A starter default."),
    weeklyLimit: evidence.weeklyLimit ?? starter<"weeklyLimit">(STARTER_DEFAULTS.weeklyLimit, "No limit unless you set one."),
    weeklyWindows:
      evidence.weeklyWindows ?? starter<"weeklyWindows">(STARTER_DEFAULTS.weeklyWindows, "A starter default: weekdays 10:00–17:00."),
  };
}

// The proposed value per field: the draft's entry, then the confirmed setting
// (for a ready host who has not changed it), then the current suggestion. A
// suggestion never replaces a drafted or confirmed value, with one exception: an
// unaccepted starter default in the draft (the browser's zone stored on first
// read) yields to an inferred suggestion (the primary calendar's zone).
export function buildFieldViews(
  draft: DraftFields,
  confirmed: ConfirmedSettings | null,
  suggestions: { [F in SetupFieldName]?: FieldSuggestion<F> },
): SetupFieldViews {
  const views: Record<string, SetupFieldView> = {};

  for (const field of SETUP_FIELD_NAMES) {
    const drafted = (draft[field] as DraftEntry | undefined) ?? null;
    const suggestion = (suggestions[field] as FieldSuggestion | undefined) ?? null;
    const saved = confirmed ? confirmedValue(confirmed, field) : undefined;
    let proposed: ProposedField | null = null;
    const yields = drafted && !drafted.accepted && drafted.source === "starter_default" && suggestion?.source === "inferred";

    if (drafted && !yields) {
      proposed = {
        accepted: drafted.accepted,
        reason: drafted.reason ?? null,
        sampleSize: drafted.sampleSize ?? null,
        source: drafted.source,
        value: drafted.value,
      };
    } else if (saved !== undefined && !yields) {
      proposed = {
        accepted: true,
        reason: null,
        sampleSize: null,
        source: confirmed!.provenance[field] ?? "stated",
        value: saved as ProposedField["value"],
      };
    } else if (suggestion) {
      proposed = { ...suggestion, accepted: false };
    }

    views[field] = { draft: drafted, proposed, suggestion };
  }

  return views as SetupFieldViews;
}

function confirmedValue(settings: ConfirmedSettings, field: SetupFieldName): unknown {
  const value = (settings as unknown as Record<string, unknown>)[field];
  // In-person fields of an online-only policy are null: not a saved answer.
  return value === null && IN_PERSON_FIELDS.includes(field) ? undefined : value;
}

export function proposedOf(views: SetupFieldViews): ProposedFields {
  return Object.fromEntries(SETUP_FIELD_NAMES.map((field) => [field, views[field].proposed])) as ProposedFields;
}

// Whether a ready host's proposal differs from what it is public on.
export function differsFromConfirmed(proposed: ProposedFields, roles: RolesForHash, settings: ConfirmedSettings) {
  const values = Object.fromEntries(Object.entries(proposalValues(proposed)).map(([field, entry]) => [field, entry.value]));
  const saved = Object.fromEntries(
    SETUP_FIELD_NAMES.flatMap((field) => {
      const value = confirmedValue(settings, field);
      return value === undefined ? [] : [[field, value]];
    }),
  );
  const savedRoles = { bookingCalendar: settings.bookingCalendar, conflictCalendars: [...settings.conflictCalendars] };

  return (
    canonicalJson(values) !== canonicalJson(saved) ||
    canonicalJson(rolesIdentity(roles)) !== canonicalJson(rolesIdentity(savedRoles))
  );
}

export function setupLinks(appOrigin: string, handle: string): SetupLinks {
  return { booking: `${appOrigin}/${handle}`, skill: `${appOrigin}/${handle}/SKILL.md` };
}

// ---------------------------------------------------------------------------
// Records

type SetupRecords = {
  readonly status: string;
  readonly profileName: string | null;
  readonly email: string | null;
  readonly calendarConnected: boolean;
  readonly grantInvalid: boolean;
  readonly draftRevision: number;
  readonly draftFields: DraftFields;
  readonly analysisSkipped: boolean;
  readonly confirmed: ConfirmedSettings | null;
};

async function readSetupRecords(q: Queryable, hostAccountId: string): Promise<SetupRecords | null> {
  const [row] = await q<{
    analysis_skipped: boolean | null;
    display_name: string | null;
    draft_fields: DraftFields | null;
    draft_revision: number | null;
    email: string | null;
    calendar_usable: boolean;
    invalidated: boolean;
    settings: ConfirmedSettings | null;
    status: string;
  }[]>`
    select a.status, a.display_name, i.email,
           ${calendarUsable(q)} as calendar_usable, coalesce(g.invalidated_at is not null, false) as invalidated,
           d.revision as draft_revision, d.fields as draft_fields, d.analysis_skipped,
           s.settings
    from app.host_accounts a
    left join app.google_identities i on i.host_account_id = a.id
    left join app.provider_grants g on g.host_account_id = a.id
    left join app.setup_drafts d on d.host_account_id = a.id
    left join app.host_settings s on s.host_account_id = a.id
    where a.id = ${hostAccountId}
  `;

  if (!row) return null;

  return {
    analysisSkipped: row.analysis_skipped ?? false,
    calendarConnected: row.calendar_usable,
    confirmed: row.settings,
    draftFields: row.draft_fields ?? {},
    draftRevision: row.draft_revision ?? 0,
    email: row.email,
    grantInvalid: row.invalidated,
    profileName: row.display_name,
    status: row.status,
  };
}

export type SetupProposal = {
  readonly records: SetupRecords;
  readonly roles: SavedCalendarRoles | null;
  readonly analysis: AnalysisCard | null;
  readonly fields: SetupFieldViews;
  readonly proposed: ProposedFields;
  readonly placeHint: PlaceHint | null;
  readonly handleAvailability: HandleAvailability | null;
  readonly missingFields: SetupFieldName[];
  readonly proposalHash: string;
};

// The suggestions with the inferred weekly windows replaced by the starter default
// when the scan counted hours in a zone other than the proposed timezone.
export function alignWindowsWithZone(
  suggestions: { [F in SetupFieldName]?: FieldSuggestion<F> },
  countedZone: string | null,
  proposedZone: string | null,
): { [F in SetupFieldName]?: FieldSuggestion<F> } {
  return countedZone && proposedZone && countedZone !== proposedZone && suggestions.weeklyWindows?.source === "inferred"
    ? { ...suggestions, weeklyWindows: windowsInOtherZone(countedZone, proposedZone) }
    : suggestions;
}

// Recomputes the proposal from durable records only. The state route, the setup
// tools and confirmation all call this, so a review's hash means the same thing in
// each.
export async function computeSetupProposal(q: Queryable, hostAccountId: string): Promise<SetupProposal | null> {
  const records = await readSetupRecords(q, hostAccountId);

  if (!records) return null;

  const [roles, analysis, current] = await Promise.all([
    readCalendarRoles(q, hostAccountId),
    readLatestAnalysis(q, hostAccountId),
    currentHandle(q, hostAccountId),
  ]);
  const evidence = analysis?.state === "completed" ? analysis.evidence : null;
  const drafted = records.draftFields.timezone;
  const needsHandle = !records.draftFields.handle && !records.confirmed;
  const proposedHandle =
    current ?? (needsHandle && records.email ? await proposeHandle(q, hostAccountId, records.email) : null);
  const suggestions = buildSuggestions({
    email: records.email,
    // Only the primary calendar's own zone is labeled as the calendar's.
    evidenceSuggestions: evidence ? suggestFromEvidence(evidence, evidence.primaryTimeZone ?? null) : null,
    profileName: records.profileName,
    proposedHandle,
    starterTimeZone: drafted?.source === "starter_default" ? drafted.value : null,
  });
  const zone = buildFieldViews(records.draftFields, records.confirmed, suggestions).timezone.proposed?.value ?? null;
  const fields = buildFieldViews(
    records.draftFields,
    records.confirmed,
    alignWindowsWithZone(suggestions, evidence?.timezone ?? null, zone),
  );
  const proposed = proposedOf(fields);
  const handle = proposed.handle?.value;
  const handleAvailability = handle ? (await checkHandle(q, hostAccountId, handle)).availability : null;

  return {
    analysis,
    fields,
    handleAvailability,
    missingFields: missingFields(proposed, handleAvailability === "available"),
    placeHint: evidence ? placeHintFromEvidence(evidence) : null,
    proposalHash: proposalHash(proposed, roles),
    proposed,
    records,
    roles,
  };
}

async function liveCalendars(deps: SetupDependencies, hostAccountId: string) {
  try {
    const calendar = await openHostCalendar(deps.calendar, hostAccountId);
    const { calendars } = await calendar.listCalendars();
    return { calendars, error: null, recommendations: recommendCalendarRoles(calendars) };
  } catch (error) {
    if (error instanceof CalendarAccessError) {
      return { calendars: null, error: error.category, recommendations: null };
    }
    throw error;
  }
}

// Stores the browser's zone as the draft's timezone starter default, once: only
// for an active host whose draft has no timezone and who has no confirmed
// settings (a ready host's confirmed zone is its proposal). It takes the account
// share lock and then the draft lock, in setup's lock order.
export async function storeBrowserTimeZone(db: Database, hostAccountId: string, zone: string) {
  if (!isValidTimeZone(zone)) return false;

  return db.begin(async (tx) => {
    const [account] = await tx<{ status: string }[]>`
      select status from app.host_accounts where id = ${hostAccountId} for share
    `;
    if (account?.status !== "active") return false;

    const draft = await lockDraft(tx, hostAccountId);
    const [settings] = await tx`select 1 from app.host_settings where host_account_id = ${hostAccountId}`;
    if (draft.fields.timezone || settings) return false;

    await writeDraft(tx, hostAccountId, {
      ...draft.fields,
      timezone: { accepted: false, reason: BROWSER_ZONE_REASON, sampleSize: null, source: "starter_default", value: zone },
    });
    return true;
  });
}

// The full card projection of the host's setup. Null when the account does not exist.
export async function readSetupState(
  deps: SetupDependencies,
  hostAccountId: string,
  options: SetupReadOptions = {},
): Promise<SetupStateView | null> {
  if ((await readReadiness(deps.db, hostAccountId)).ready) {
    // Best effort: a failed recheck leaves the confirmed destination as it was.
    await recheckConfirmedDestination(deps.calendar, hostAccountId).catch(() => "unknown");
  }

  let proposal = await computeSetupProposal(deps.db, hostAccountId);

  if (!proposal) return null;

  if (options.browserTimeZone && !proposal.records.draftFields.timezone && !proposal.records.confirmed) {
    // Recomputed even when a concurrent read stored a zone first: the lock waited
    // for it, so this read never returns the revision from before that write.
    await storeBrowserTimeZone(deps.db, hostAccountId, options.browserTimeZone);
    proposal = await computeSetupProposal(deps.db, hostAccountId);
    if (!proposal) return null;
  }

  const readiness = await readReadiness(deps.db, hostAccountId);
  const { records, roles, analysis } = proposal;
  const lost = destinationLost(roles, records.confirmed);
  const nextAction = deriveNextAction({
    analysisPending: analysis?.state === "pending",
    analysisSkipped: records.analysisSkipped,
    calendarConnected: records.calendarConnected,
    destinationLost: lost,
    hasRoles: roles !== null,
    missingCount: proposal.missingFields.length,
    ready: readiness.ready,
  });
  const live =
    records.calendarConnected && (nextAction === "choose_calendars" || options.includeCalendars)
      ? await liveCalendars(deps, hostAccountId)
      : { calendars: null, error: null, recommendations: null };

  return {
    account: { googleEmail: records.email },
    analysis,
    analysisSkipped: records.analysisSkipped,
    calendar: { connected: records.calendarConnected, destinationLost: lost, invalid: records.grantInvalid, ...live },
    draft: { revision: records.draftRevision },
    fields: proposal.fields,
    handleAvailability: proposal.handleAvailability,
    links: readiness.ready && readiness.handle ? setupLinks(deps.appOrigin, readiness.handle) : null,
    missingFields: proposal.missingFields,
    nextAction,
    pendingChanges:
      readiness.ready && records.confirmed !== null && differsFromConfirmed(proposal.proposed, roles, records.confirmed),
    placeHint: proposal.placeHint,
    proposalHash: proposal.proposalHash,
    readiness,
    roles,
  };
}
