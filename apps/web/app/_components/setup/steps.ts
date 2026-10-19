import type { SetupFieldName } from "@lib/contracts/setup";
import type { SetupState } from "@/lib/setup/client";

// The setup stepper, derived from server state on the client: one card at a
// time, in a fixed order, starting at the first step whose value the host has
// not accepted. Skipping and walking back are client-side only; the server's
// rules for what confirmation needs are unchanged.

export const STEP_IDS = [
  "timezone",
  "windows",
  "limit",
  "duration",
  "notes",
  "mode",
  "location",
  "transport",
  "travelBuffer",
  "identity",
] as const;

export type StepId = (typeof STEP_IDS)[number];
export type StepTarget = StepId | "review";

export const STEP_FIELDS: Readonly<Record<StepId, readonly SetupFieldName[]>> = {
  duration: ["durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes"],
  identity: ["displayName", "handle"],
  limit: ["weeklyLimit"],
  location: ["location"],
  mode: ["meetingMode"],
  notes: ["noteExclusions"],
  timezone: ["timezone"],
  transport: ["travelMode"],
  travelBuffer: ["travelBufferMinutes"],
  windows: ["weeklyWindows"],
};

export const STEP_CARD_IDS: Readonly<Record<StepTarget, string>> = {
  duration: "setup-duration",
  identity: "setup-identity",
  limit: "setup-limit",
  location: "setup-location",
  mode: "setup-mode",
  notes: "setup-notes",
  review: "setup-review",
  timezone: "setup-timezone",
  transport: "setup-transport",
  travelBuffer: "setup-travel-buffer",
  windows: "setup-windows",
};

type StepState = Pick<SetupState, "analysis" | "fields" | "missingFields">;

// The host's accepted meeting mode, which decides whether the in-person steps exist.
export function acceptedMode(state: Pick<SetupState, "fields">) {
  const proposed = state.fields.meetingMode.proposed;
  return proposed?.accepted ? proposed.value : null;
}

// The note-like entries a completed scan found; the step exists only for them.
export function noteEntries(state: Pick<SetupState, "analysis">) {
  return state.analysis?.state === "completed" ? (state.analysis.evidence?.noteLike.entries ?? []) : [];
}

// The steps this host walks through, in order.
export function setupSteps(state: StepState): StepId[] {
  const mode = acceptedMode(state);
  const inPerson = mode === "in_person" || mode === "either";
  return STEP_IDS.filter((step) => {
    if (step === "notes") return noteEntries(state).length > 0;
    if (step === "location" || step === "transport" || step === "travelBuffer") return inPerson;
    return true;
  });
}

// Whether the host has accepted every value of a step. The identity step also
// needs a valid display name and an available handle.
export function stepAccepted(state: StepState, step: StepId) {
  const accepted = STEP_FIELDS[step].every((field) => state.fields[field].proposed?.accepted === true);
  if (step !== "identity") return accepted;
  return accepted && !state.missingFields.includes("handle") && !state.missingFields.includes("displayName");
}

// The first step neither accepted nor skipped, or the review once there is none.
export function firstOpenStep(state: StepState, skipped: ReadonlySet<StepId>): StepTarget {
  return setupSteps(state).find((step) => !skipped.has(step) && !stepAccepted(state, step)) ?? "review";
}

// The review's position: after the last step.
export function stepIndex(steps: readonly StepId[], target: StepTarget) {
  return target === "review" ? steps.length : steps.indexOf(target);
}

// Where moving forward from `from` lands: the next step while it comes before
// the first open one, otherwise the first open one (null, so the pointer clears).
export function forwardTarget(steps: readonly StepId[], from: StepTarget, open: StepTarget): StepTarget | null {
  const next = stepIndex(steps, from) + 1;
  return next < stepIndex(steps, open) ? (steps[next] ?? null) : null;
}

// Where Back lands: the previous step, or nothing before the first one.
export function backTarget(steps: readonly StepId[], from: StepTarget): StepTarget | null {
  const index = stepIndex(steps, from);
  return index > 0 ? (steps[index - 1] ?? null) : null;
}

// The step that owns a field, for the review's Edit links and missing values.
export function stepForField(field: SetupFieldName): StepId {
  return STEP_IDS.find((step) => STEP_FIELDS[step].includes(field)) ?? "timezone";
}
