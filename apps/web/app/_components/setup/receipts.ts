import type { SetupFieldName, ValueSource } from "@lib/contracts/setup";
import type { SetupState } from "@/lib/setup/client";
import {
  describeLimit,
  describeLocation,
  describeTravelMode,
  formatMinutes,
  groupWindows,
  MEETING_MODE_LABELS,
} from "./format";
import { setupSteps, STEP_FIELDS, STEP_IDS, STEP_LABELS, type StepId, stepAccepted } from "./steps";

// The setup conversation's receipts: one compact line per answered card, left in
// the history where it was answered. Every receipt is derived from durable server
// state on each load (a draft field's acceptedAt and history, the calendar roles'
// saved time, the scan's completion and the confirmation time), never from a log
// kept in the browser, so a reload or another device shows the same history. A
// value the assistant drafts is never accepted, so it never makes a receipt. The
// one exception is Skip for now, which saves nothing and so lasts for this visit.

export type ReceiptKind = "step" | "skipped" | "calendars" | "analysis" | "confirmed";

export type Receipt = {
  readonly id: string;
  readonly kind: ReceiptKind;
  readonly step: StepId | null;
  // When it was answered (ISO time); null for an answer saved before receipts
  // existed, which is placed after the messages.
  readonly at: string | null;
  readonly label: string;
  readonly value: string;
  readonly source: ValueSource | null;
  // The newer receipt of the same step, when this answer was changed later.
  readonly changedTo: string | null;
};

// Writes of one card action (a step with several fields saves them as a chain of
// commands, each field once) land within this long of each other and make one
// receipt.
export const RECEIPT_GROUP_MS = 5_000;

type FieldValues = Partial<Record<SetupFieldName, unknown>>;

// A step's values in one short line.
export function stepValueText(step: StepId, values: FieldValues): string {
  const has = (field: SetupFieldName) => values[field] !== undefined;

  switch (step) {
    case "timezone":
      return has("timezone") ? String(values.timezone).replaceAll("_", " ") : "";
    case "windows": {
      if (!Array.isArray(values.weeklyWindows)) return "";
      const groups = groupWindows(values.weeklyWindows).filter((group) => group.ranges);
      return groups.length > 0 ? groups.map((group) => `${group.days} ${group.ranges}`).join("; ") : "No windows";
    }
    case "limit":
      return has("weeklyLimit") ? describeLimit((values.weeklyLimit as number | null) ?? null) : "";
    case "duration": {
      const parts = [
        has("durationMinutes") ? formatMinutes(values.durationMinutes as number) : null,
        has("bufferBeforeMinutes") ? `${formatMinutes(values.bufferBeforeMinutes as number)} before` : null,
        has("bufferAfterMinutes") ? `${formatMinutes(values.bufferAfterMinutes as number)} after` : null,
      ];
      return parts.filter(Boolean).join(", ");
    }
    case "notes": {
      const count = Array.isArray(values.noteExclusions) ? values.noteExclusions.length : 0;
      return count === 0 ? "None excluded" : `${count} excluded from busy time`;
    }
    case "mode":
      return has("meetingMode") ? MEETING_MODE_LABELS[values.meetingMode as keyof typeof MEETING_MODE_LABELS] : "";
    case "location":
      return has("location") ? describeLocation(values.location as Parameters<typeof describeLocation>[0]) : "";
    case "transport":
      return has("travelMode") ? describeTravelMode(values.travelMode as Parameters<typeof describeTravelMode>[0]) : "";
    case "travelBuffer":
      return has("travelBufferMinutes") ? formatMinutes(values.travelBufferMinutes as number) : "";
    case "identity":
      return [has("displayName") ? String(values.displayName) : null, has("handle") ? `/${String(values.handle)}` : null]
        .filter(Boolean)
        .join(", ");
  }
}

type Acceptance = { readonly field: SetupFieldName; readonly value: unknown; readonly source: ValueSource; readonly at: string | null };

function time(at: string | null) {
  return at === null ? Number.POSITIVE_INFINITY : Date.parse(at);
}

// Every answer the host accepted for a step's fields: the field's history, then
// its current value when it is accepted. Oldest first; undated answers last.
function acceptances(state: Pick<SetupState, "fields">, step: StepId): Acceptance[] {
  const found: Acceptance[] = [];

  for (const field of STEP_FIELDS[step]) {
    const draft = state.fields[field].draft;
    if (!draft) continue;
    for (const earlier of draft.history ?? []) {
      found.push({ at: earlier.acceptedAt, field, source: earlier.source, value: earlier.value });
    }
    if (draft.accepted) found.push({ at: draft.acceptedAt ?? null, field, source: draft.source, value: draft.value });
  }

  return found.sort((a, b) => time(a.at) - time(b.at));
}

// A step's receipts, one per card action: the answers of one action (different
// fields, saved within RECEIPT_GROUP_MS of the first) are grouped,
// each receipt shows the step's values as they stood after it, and every receipt
// but the newest points at the one that changed it.
export function stepReceipts(state: Pick<SetupState, "fields">, step: StepId): Receipt[] {
  const groups: Acceptance[][] = [];

  for (const acceptance of acceptances(state, step)) {
    const group = groups.at(-1);
    const first = group?.[0];
    // One action writes each field once, so a field already in the group starts
    // the next receipt however soon it follows (a quick Edit, say).
    const together =
      first !== undefined &&
      !group!.some((member) => member.field === acceptance.field) &&
      (first.at === null ? acceptance.at === null : acceptance.at !== null && time(acceptance.at) - time(first.at) <= RECEIPT_GROUP_MS);
    if (group && together) group.push(acceptance);
    else groups.push([acceptance]);
  }

  const values: FieldValues = {};
  const sources: Partial<Record<SetupFieldName, ValueSource>> = {};
  const receipts = groups.map((group) => {
    for (const acceptance of group) {
      values[acceptance.field] = acceptance.value;
      sources[acceptance.field] = acceptance.source;
    }
    const at = group.at(-1)!.at;
    const primary = STEP_FIELDS[step].find((field) => sources[field] !== undefined);
    return {
      at,
      changedTo: null as string | null,
      id: `step-${step}-${at ?? "undated"}`,
      kind: "step" as const,
      label: STEP_LABELS[step],
      source: primary ? sources[primary]! : null,
      step,
      value: stepValueText(step, values),
    };
  });

  for (const [index, receipt] of receipts.entries()) receipt.changedTo = receipts[index + 1]?.id ?? null;

  return receipts;
}

function weeksEachWay(range: { readonly start: string; readonly end: string }) {
  const days = (Date.parse(range.end) - Date.parse(range.start)) / 86_400_000;
  return Math.max(1, Math.round(days / 2 / 7));
}

const KIND_ORDER: Readonly<Record<ReceiptKind, number>> = { analysis: 1, calendars: 0, confirmed: 4, skipped: 3, step: 2 };

// Every receipt for this state, oldest first. `skipped` holds this visit's skips.
export function deriveReceipts(
  state: Pick<SetupState, "analysis" | "analysisSkipped" | "confirmedAt" | "fields" | "missingFields" | "readiness" | "roles">,
  skipped: ReadonlyMap<StepId, string> = new Map(),
): Receipt[] {
  const receipts: Receipt[] = [];
  const steps = setupSteps(state);

  if (state.roles) {
    const count = state.roles.conflictCalendars.length;
    receipts.push({
      at: state.roles.savedAt,
      changedTo: null,
      id: "calendars",
      kind: "calendars",
      label: "Calendars",
      source: null,
      step: null,
      value: `Checks ${count} calendar${count === 1 ? "" : "s"}, books into ${state.roles.bookingCalendar.summary}`,
    });
  }

  const analysis = state.analysis;
  const scanSettled =
    analysis?.state === "completed" && (state.analysisSkipped || analysis.calendars.every((calendar) => calendar.ok !== false));
  if (analysis && scanSettled && analysis.completedAt) {
    const read = analysis.calendars.filter((calendar) => calendar.ok !== false).length;
    const weeks = weeksEachWay(analysis.range);
    const meetings = analysis.evidence?.meetingLoad.sampleSize ?? 0;
    receipts.push({
      at: analysis.completedAt,
      changedTo: null,
      id: `analysis-${analysis.id}`,
      kind: "analysis",
      label: "Calendar scan",
      source: null,
      step: null,
      value: `Read ${read} calendar${read === 1 ? "" : "s"} · ${weeks} week${weeks === 1 ? "" : "s"} back and ahead · ${meetings} meeting${meetings === 1 ? "" : "s"}`,
    });
  }

  // Receipts of steps that no longer apply (in-person steps after choosing
  // Online, say) are left out: their Edit would have nowhere to go.
  for (const step of STEP_IDS) if (steps.includes(step)) receipts.push(...stepReceipts(state, step));

  for (const [step, at] of skipped) {
    if (!steps.includes(step) || stepAccepted(state, step)) continue;
    receipts.push({
      at,
      changedTo: null,
      id: `skipped-${step}`,
      kind: "skipped",
      label: STEP_LABELS[step],
      source: null,
      step,
      value: "Skipped",
    });
  }

  if (state.readiness.ready && state.confirmedAt) {
    receipts.push({
      at: state.confirmedAt,
      changedTo: null,
      id: `confirmed-${state.confirmedAt}`,
      kind: "confirmed",
      label: "Settings confirmed",
      source: null,
      step: null,
      value: "",
    });
  }

  return receipts
    .map((receipt, index) => ({ index, receipt }))
    .sort((a, b) => time(a.receipt.at) - time(b.receipt.at) || KIND_ORDER[a.receipt.kind] - KIND_ORDER[b.receipt.kind] || a.index - b.index)
    .map(({ receipt }) => receipt);
}

export type TimelineEntry<M> =
  | { readonly kind: "message"; readonly message: M }
  | { readonly kind: "receipt"; readonly receipt: Receipt };

// Places receipts among the conversation's messages by time. A message's time is
// the meta.at of the stream event that first produced it; a message without one
// takes the time of the message before it (or the start of the conversation).
// A receipt goes after every message that started at or before its time and
// before the first one that started later, so it sits where the host answered.
// Receipts with no time go after the last message. Receipts keep their own order
// (deriveReceipts sorts them).
export function interleave<M>(
  messages: readonly { readonly message: M; readonly at: string | null }[],
  receipts: readonly Receipt[],
): TimelineEntry<M>[] {
  const timeline: TimelineEntry<M>[] = [];
  let next = 0;
  let previous = Number.NEGATIVE_INFINITY;

  for (const { at, message } of messages) {
    const parsed = at === null ? Number.NaN : Date.parse(at);
    const started = Number.isNaN(parsed) ? previous : parsed;
    previous = started;
    while (next < receipts.length && time(receipts[next]!.at) < started) {
      timeline.push({ kind: "receipt", receipt: receipts[next]! });
      next += 1;
    }
    timeline.push({ kind: "message", message });
  }

  for (; next < receipts.length; next += 1) timeline.push({ kind: "receipt", receipt: receipts[next]! });

  return timeline;
}
