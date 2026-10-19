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
import { backTarget, firstOpenStep, forwardTarget, setupSteps, type StepId, type StepTarget } from "./steps";

// The setup cards' shared controller: the server-derived state, one command at a
// time with retry identity, a notice shown beside the card that acted, and the
// client-side step pointer (Back, Edit, Skip for now). State is reloaded on load,
// after every card action and after every assistant turn.

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

// An explicit place in the stepper, set by Back, Edit or moving forward through
// steps already answered. Without one, the first open step is shown.
export type StepView = { readonly step: StepTarget; readonly returnToReview: boolean };

type SetupContextValue = {
  readonly state: SetupState;
  readonly view: StepView | null;
  readonly skipped: ReadonlySet<StepId>;
  // Before Calendar is connected, the host chose to set other preferences now.
  readonly early: boolean;
  readonly setView: (view: StepView | null) => void;
  readonly setSkipped: (skipped: ReadonlySet<StepId>) => void;
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

// The current card of the stepper and the moves from it. Inside setup, the card
// is the explicit view if it still exists, else the first open step; a ready host
// with pending changes sees the review unless they chose a step to edit.
export function useStepper() {
  const { early, setEarly, setSkipped, setView, skipped, state, view } = useSetup();
  const steps = setupSteps(state);
  const open = firstOpenStep(state, skipped);
  const pointed = view && (view.step === "review" || steps.includes(view.step)) ? view : null;
  const current: StepTarget = pointed?.step ?? (state.nextAction === "ready" ? "review" : open);
  const returnToReview = pointed?.returnToReview ?? false;
  const previous = backTarget(steps, current);

  const forward = (skippedNow: ReadonlySet<StepId> = skipped) => {
    if (returnToReview) {
      setView({ returnToReview: false, step: "review" });
      return;
    }
    const target = forwardTarget(steps, current, firstOpenStep(state, skippedNow));
    setView(target ? { returnToReview: false, step: target } : null);
  };

  return {
    canGoBack: current !== "review" && (returnToReview || previous !== null || early),
    current,
    // Leaves an edit for the review, or goes to the previous step, or, on the
    // first step before Calendar is connected, back to the Connect card.
    back() {
      if (returnToReview) setView({ returnToReview: false, step: "review" });
      else if (previous) setView({ returnToReview: false, step: previous });
      else if (early) {
        setView(null);
        setEarly(false);
      }
    },
    edit(step: StepId) {
      setView({ returnToReview: true, step });
    },
    forward: () => forward(),
    position: current === "review" ? null : steps.indexOf(current) + 1,
    returnToReview,
    // A saved step hands back to the first open step, which is the review once
    // everything is accepted or skipped.
    saved() {
      setView(null);
    },
    skip() {
      if (current === "review") return;
      const next = new Set(skipped).add(current);
      setSkipped(next);
      forward(next);
    },
    skipped,
    steps,
  };
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
  const [view, setView] = useState<StepView | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<StepId>>(() => new Set());
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

  // Leaving the stepper (to connect, choose calendars or wait for the scan, or
  // once confirmed) forgets its client-side place.
  const nextAction = state?.nextAction;
  const lastAction = useRef(nextAction);
  useEffect(() => {
    if (lastAction.current === nextAction) return;
    lastAction.current = nextAction;
    setView(null);
    if (!nextAction || !STEPPER_ACTIONS.has(nextAction) || nextAction === "ready") setSkipped(new Set());
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
            editingCalendars,
            notice,
            retry,
            run: execute,
            setEarly,
            setEditingCalendars,
            setSkipped,
            setView,
            skipped,
            state,
            view,
          }
        : null,
    [busy, early, editingCalendars, execute, notice, retry, setEditingCalendars, skipped, state, view],
  );

  return { loadError, reload, state, value };
}

export function SetupProvider({ children, value }: { readonly children: ReactNode; readonly value: SetupContextValue }) {
  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
}
