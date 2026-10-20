"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { AnalysisCard, NotesStep, scanNeedsHost } from "./analysis-card";
import { CalendarRolesCard, ConnectCalendarCard } from "./calendar-cards";
import { focusCard } from "./card";
import { LocationStep, ModeStep, TransportStep } from "./question-cards";
import { CHANGE_CALENDARS_ID, IdentityStep, ReviewCard } from "./review-card";
import { useSetup, useStepper } from "./setup-context";
import { ShareLinksCard } from "./share-links-card";
import type { StepTarget } from "./steps";
import { DurationStep, TimezoneStep, TravelBufferStep, WeeklyLimitStep, WeeklyWindowsStep } from "./suggestion-cards";

// Exactly one open setup card, placed after the latest message and above the
// composer: one thing to think about at once. Answered cards are not here: they
// are receipts in the conversation (receipt.tsx), placed where they were
// answered. Which card is open is derived from the server's next action and,
// inside setup, from the first open step or the step asked again with Edit.

// Moves focus to the visible card's heading, as the workspace menu's Setup item does.
export function focusCurrentCard() {
  const card = document.querySelector<HTMLElement>("[data-setup-card]");
  if (card) focusCard(card.id);
}

function StepView({ step }: { readonly step: StepTarget }) {
  switch (step) {
    case "timezone":
      return <TimezoneStep />;
    case "windows":
      return <WeeklyWindowsStep />;
    case "limit":
      return <WeeklyLimitStep />;
    case "duration":
      return <DurationStep />;
    case "notes":
      return <NotesStep />;
    case "mode":
      return <ModeStep />;
    case "location":
      return <LocationStep />;
    case "transport":
      return <TransportStep />;
    case "travelBuffer":
      return <TravelBufferStep />;
    case "identity":
      return <IdentityStep />;
    case "review":
      return <ReviewCard />;
  }
}

// The one card for the current state, with a key that names it.
function useCurrentCard() {
  const { early, editingCalendars, setEarly, setEditingCalendars, state } = useSetup();
  const stepper = useStepper();

  const closeCalendars = (saved: boolean) => {
    setEditingCalendars(false);
    if (!saved) window.requestAnimationFrame(() => document.getElementById(CHANGE_CALENDARS_ID)?.focus());
  };

  if (editingCalendars && state.nextAction !== "connect_calendar") {
    return { card: <CalendarRolesCard onClose={closeCalendars} />, key: "calendars-edit" };
  }

  switch (state.nextAction) {
    case "connect_calendar":
      // Other preferences can be set before Calendar is connected, one step at a
      // time; once they are done (or skipped), the Connect card returns.
      if (early && stepper.current !== "review") {
        return { card: <StepView step={stepper.current} />, key: stepper.current };
      }
      return { card: <ConnectCalendarCard onSetOtherPreferences={() => setEarly(true)} />, key: "connect" };
    case "choose_calendars":
      return { card: <CalendarRolesCard />, key: "calendars" };
    case "analyzing":
      return { card: <AnalysisCard />, key: "analysis" };
    case "review_suggestions":
    case "confirm_settings":
      if (scanNeedsHost(state)) return { card: <AnalysisCard />, key: "analysis" };
      return { card: <StepView step={stepper.current} />, key: stepper.current };
    case "ready":
      if (state.pendingChanges || stepper.current !== "review") {
        return {
          card: stepper.current === "review" ? <ReviewCard pending={state.pendingChanges} /> : <StepView step={stepper.current} />,
          key: stepper.current,
        };
      }
      return { card: <ShareLinksCard />, key: "links" };
  }
}

// The height a card may take: the conversation's visible height less its
// padding, so a long card (the weekly windows editor, the review) scrolls inside
// itself and never pushes its actions under the composer.
function useCardRoom() {
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);

  useEffect(() => {
    const log = ref.current?.closest<HTMLElement>("[data-slot=message-scroller-viewport]");
    if (!log) return;
    const measure = () => setRoom(Math.max(240, Math.floor(log.clientHeight - 48)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(log);
    return () => observer.disconnect();
  }, []);

  return { ref, style: (room ? { "--setup-card-room": `${room}px` } : undefined) as CSSProperties | undefined };
}

export function SetupCards() {
  const { card, key } = useCurrentCard();
  const previous = useRef(key);
  const room = useCardRoom();

  // A changed card moves focus to its heading; the first render leaves focus
  // where it is (the composer).
  useEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    const element = document.querySelector<HTMLElement>("[data-setup-card]");
    if (element) focusCard(element.id);
  }, [key]);

  return (
    <div className="flex min-w-0 flex-col" data-setup-step={key} ref={room.ref} style={room.style}>
      <StepFrame key={key}>{card}</StepFrame>
    </div>
  );
}

// Remounts the card's state when the step changes.
function StepFrame({ children }: { readonly children: ReactNode }) {
  return children;
}
