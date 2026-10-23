"use client";

import type { SetupOperation } from "@lib/contracts/setup";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  browserTimeZone,
  createRetryKeys,
  readSetupState,
  runSetupCommand,
  type SetupCommandAttempt,
  SetupRequestError,
  type SetupState,
} from "@/lib/setup/client";
import { focusCard } from "./card";
import { firstOpenStep, setupSteps, type StepId, type StepTarget } from "./steps";

// The setup cards' shared controller: the server-derived state, one command at a
// time with retry identity, a notice shown beside the card that acted, and the
// client-side choices that save nothing: which answered step is being asked again
// (Edit on a receipt) and which steps were skipped for now. State is reloaded on
// load, after every card action and after every assistant turn.

export const STALE_MESSAGE = "This changed since you last saw it. Here is the current version.";

export type SetupNotice = {
  readonly anchor: string;
  readonly tone: "error" | "info";
  readonly message: string;
  // An uncertain attempt can be resent as the same intent.
  readonly canRetry?: boolean;
};

// One command of a card action. "previous" chains on the revision the previous
// command returned, so a group action (duration and both buffers) applies in order.
export type SetupStep = {
  readonly operation: SetupOperation;
  readonly input: Readonly<Record<string, unknown>>;
  readonly expectedRevision: number | null | "previous";
};

// When each step was skipped for now (ISO time), for its muted receipt. Skips
// save nothing, so they last only for this visit.
export type SkippedSteps = ReadonlyMap<StepId, string>;

export type SetupContextValue = {
  readonly state: SetupState;
  // The answered step asked again at the bottom after Edit, or the review.
  readonly editing: StepTarget | null;
  readonly skipped: SkippedSteps;
  // Before Calendar is connected, the host chose to set other preferences now.
  readonly early: boolean;
  readonly setEditing: (step: StepTarget | null) => void;
  readonly setSkipped: (skipped: SkippedSteps) => void;
  readonly setEarly: (early: boolean) => void;
  readonly busy: string | null;
  readonly notice: SetupNotice | null;
  readonly editingCalendars: boolean;
  readonly run: (anchor: string, steps: readonly SetupStep[]) => Promise<boolean>;
  readonly retry: () => Promise<boolean>;
  readonly dismissNotice: () => void;
  readonly setEditingCalendars: (editing: boolean) => void;
};

const SetupContext = createContext<SetupContextValue | null>(null);

export function useSetup() {
  const value = useContext(SetupContext);
  if (!value) throw new Error("useSetup must be used inside SetupProvider.");
  return value;
}

const STEPPER_ACTIONS = new Set(["connect_calendar", "review_suggestions", "confirm_settings", "ready"]);
const EDITABLE_ACTIONS: ReadonlySet<string> = STEPPER_ACTIONS;

// A failed or partial scan that the host has not set aside holds the open card.
function scanBlocks(state: SetupState) {
  const analysis = state.analysis;
  if (!analysis || state.analysisSkipped || state.nextAction === "ready") return false;
  return analysis.state === "failed" || (analysis.state === "completed" && analysis.calendars.some((calendar) => calendar.ok === false));
}

// The one open card of setup and the moves from it. Inside setup, the open card
// is the step being edited if it still exists, else the first open step; a ready
// host sees the review (or the share links) unless they chose a step to edit.
// There is no Back: answered steps are receipts in the conversation, and Edit on
// one asks that step again here, at the bottom.
export function useStepper() {
  const { early, editing, setEarly, setEditing, setSkipped, skipped, state } = useSetup();
  const steps = setupSteps(state);
  const skippedSet = new Set(skipped.keys());
  const open = firstOpenStep(state, skippedSet);
  const edited = editing && (editing === "review" || steps.includes(editing)) ? editing : null;
  const current: StepTarget = edited ?? (state.nextAction === "ready" ? "review" : open);

  return {
    current,
    early,
    // Whether the open card asks an answered step again.
    editing: edited !== null && edited !== "review",
    // Whether Edit on a receipt can open its step now: not while connecting
    // calendars from scratch, waiting for the scan or resolving a failed one.
    canEdit: EDITABLE_ACTIONS.has(state.nextAction) && !scanBlocks(state),
    // Asks a step again at the bottom, with focus on its fresh card. Before
    // Calendar is connected that is the early steps' card.
    edit(step: StepId) {
      if (state.nextAction === "connect_calendar") setEarly(true);
      setEditing(step);
      window.requestAnimationFrame(() => focusOpenCard());
    },
    // Leaves an edit or an answered step without saving: the next open card.
    forward() {
      setEditing(null);
    },
    // Before Calendar is connected: back to the Connect card.
    leaveEarly() {
      setEditing(null);
      setEarly(false);
    },
    position: current === "review" ? null : steps.indexOf(current) + 1,
    // A saved step hands over to the first open step, which is the review once
    // everything is accepted or skipped.
    saved() {
      setEditing(null);
    },
    skip() {
      if (current === "review") return;
      const next = new Map(skipped);
      next.set(current, new Date().toISOString());
      setSkipped(next);
      setEditing(null);
    },
    skipped: skippedSet,
    steps,
  };
}

// Moves focus to the open card's heading.
export function focusOpenCard() {
  const card = document.querySelector<HTMLElement>("[data-setup-card]");
  if (card) focusCard(card.id);
}

export const DESTINATION_LOST_MESSAGE =
  "Your booking calendar can no longer take new events. Choose a calendar you can add events to.";

function refusalMessage(code: string, message: string, reason?: string) {
  if (code === "stale_revision") return STALE_MESSAGE;
  if (reason === "destination_not_writable") return DESTINATION_LOST_MESSAGE;
  if (code === "invalid_input") return "That couldn't be saved. Check the values and try again.";
  if (code === "calendar_access_revoked" || code === "calendar_not_connected") {
    return "Google Calendar access is missing. Connect Google Calendar again to continue.";
  }
  if (code === "calendar_unavailable") return "Google Calendar couldn't be read right now. Try again in a moment.";
  return message;
}

// Owns the setup state for the workspace. `reload` is what the workspace calls
// on load and after an assistant turn settles.
export function useSetupController() {
  const [state, setState] = useState<SetupState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<SetupNotice | null>(null);
  const [editingCalendars, setEditingCalendarsState] = useState(false);
  const [editing, setEditing] = useState<StepTarget | null>(null);
  const [skipped, setSkipped] = useState<SkippedSteps>(() => new Map());
  const [early, setEarly] = useState(false);
  const editingRef = useRef(false);
  const timeZone = useMemo(() => browserTimeZone(), []);
  const retryKeys = useMemo(() => createRetryKeys(), []);
  const sequence = useRef(0);
  const pendingRef = useRef<{ anchor: string; steps: readonly SetupStep[] } | null>(null);

  const reload = useCallback(async () => {
    const ticket = (sequence.current += 1);

    try {
      const next = await readSetupState(timeZone, { calendars: editingRef.current });
      // A slower, older read never replaces a newer one.
      if (ticket === sequence.current) {
        setState(next);
        setLoadError(null);
      }
    } catch (cause) {
      if (ticket === sequence.current) {
        setLoadError(cause instanceof SetupRequestError ? cause.message : "Setup couldn't be loaded right now.");
      }
    }
  }, [timeZone]);

  const setEditingCalendars = useCallback(
    (editing: boolean) => {
      editingRef.current = editing;
      setEditingCalendarsState(editing);
      if (editing) void reload();
    },
    [reload],
  );

  const execute = useCallback(
    async (anchor: string, steps: readonly SetupStep[]) => {
      const signature = JSON.stringify(steps);
      const keys = retryKeys.keysFor(signature, steps.length);
      setBusy(anchor);
      setNotice(null);
      let revision: number | null = null;
      let failure: SetupCommandAttempt<unknown> | null = null;

      try {
        for (const [index, step] of steps.entries()) {
          const expectedRevision: number | null = step.expectedRevision === "previous" ? revision : step.expectedRevision;
          const attempt: SetupCommandAttempt<{ revision?: number }> = await runSetupCommand<{ revision?: number }>({
            expectedRevision,
            input: step.input,
            operation: step.operation,
            retryKey: keys[index]!,
          });

          if (attempt.kind !== "ok") {
            failure = attempt;
            break;
          }

          revision = typeof attempt.result?.revision === "number" ? attempt.result.revision : expectedRevision;
        }

        if (!failure) {
          retryKeys.settle();
          pendingRef.current = null;
          return true;
        }

        if (failure.kind === "uncertain") {
          // Kept as the same intent: a retry replays instead of writing twice.
          pendingRef.current = { anchor, steps };
          setNotice({ anchor, canRetry: true, message: failure.message, tone: "error" });
        } else if (failure.kind === "refused") {
          retryKeys.settle();
          pendingRef.current = null;
          setNotice({
            anchor,
            message: refusalMessage(failure.code, failure.message, failure.reason),
            tone: failure.code === "stale_revision" ? "info" : "error",
          });
        }

        return false;
      } finally {
        // Every outcome, including an uncertain one, is followed by a fresh read.
        await reload();
        setBusy(null);
      }
    },
    [reload, retryKeys],
  );

  // Leaving the steps (to connect, choose calendars or wait for the scan, or once
  // confirmed) forgets the edit in progress and, outside setup, the skips.
  const nextAction = state?.nextAction;
  const lastAction = useRef(nextAction);
  useEffect(() => {
    if (lastAction.current === nextAction) return;
    lastAction.current = nextAction;
    setEditing(null);
    if (!nextAction || !STEPPER_ACTIONS.has(nextAction) || nextAction === "ready") setSkipped(new Map());
    if (nextAction !== "connect_calendar") setEarly(false);
  }, [nextAction]);

  const retry = useCallback(async () => {
    const pending = pendingRef.current;
    return pending ? execute(pending.anchor, pending.steps) : false;
  }, [execute]);

  const value = useMemo<SetupContextValue | null>(
    () =>
      state
        ? {
            busy,
            dismissNotice: () => setNotice(null),
            early,
            editing,
            editingCalendars,
            notice,
            retry,
            run: execute,
            setEarly,
            setEditingCalendars,
            setEditing,
            setSkipped,
            skipped,
            state,
          }
        : null,
    [busy, early, editing, editingCalendars, execute, notice, retry, setEditingCalendars, skipped, state],
  );

  return { loadError, reload, state, value };
}

// A null value (setup not loaded yet) keeps the same tree, so the children do
// not remount and lose their state when it loads; useSetup still requires one.
export function SetupProvider({ children, value }: { readonly children: ReactNode; readonly value: SetupContextValue | null }) {
  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
}
