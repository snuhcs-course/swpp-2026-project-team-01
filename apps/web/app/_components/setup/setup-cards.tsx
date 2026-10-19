"use client";

import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SetupState } from "@/lib/setup/client";
import { cn } from "@/lib/utils";
import { ANALYSIS_CARD_ID, AnalysisCard } from "./analysis-card";
import { CALENDARS_CARD_ID, CalendarRolesCard, CONNECT_CARD_ID, ConnectCalendarCard } from "./calendar-cards";
import { focusCard } from "./card";
import { answeredMode, LocationCard, ModeCard, TransportCard, TravelBufferCard } from "./question-cards";
import { CHANGE_CALENDARS_ID, FIELD_TARGETS, REVIEW_CARD_ID, ReviewCard } from "./review-card";
import { useSetup } from "./setup-context";
import { LINKS_CARD_ID, ShareLinksCard } from "./share-links-card";
import { DurationCard, TimezoneCard, WeeklyLimitCard, WeeklyWindowsCard } from "./suggestion-cards";

// The current step's cards, placed after the conversation and above the
// composer. Which cards show is derived from the server's next action only.

// The card that represents the current step: where focus goes when the step
// changes and where the workspace menu's Setup item leads.
export function currentCardId(state: SetupState) {
  switch (state.nextAction) {
    case "connect_calendar":
      return CONNECT_CARD_ID;
    case "choose_calendars":
      return CALENDARS_CARD_ID;
    case "analyzing":
      return ANALYSIS_CARD_ID;
    case "review_suggestions": {
      const first = state.missingFields.map((field) => FIELD_TARGETS[field].card).find((id) => document.getElementById(id));
      return first ?? REVIEW_CARD_ID;
    }
    case "confirm_settings":
      return REVIEW_CARD_ID;
    case "ready":
      return state.pendingChanges ? REVIEW_CARD_ID : LINKS_CARD_ID;
  }
}

export function focusCurrentCard(state: SetupState) {
  focusCard(currentCardId(state));
}

function PreferenceCards() {
  const { state } = useSetup();
  const mode = answeredMode(state);
  const inPerson = mode === "in_person" || mode === "either";

  return (
    <>
      <TimezoneCard />
      <WeeklyWindowsCard />
      <WeeklyLimitCard />
      <DurationCard />
      <ModeCard />
      {inPerson ? (
        <>
          <LocationCard />
          <TransportCard />
          <TravelBufferCard />
        </>
      ) : null}
    </>
  );
}

export function SetupCards() {
  const { editingCalendars, setEditingCalendars, state } = useSetup();
  const step = state.nextAction;
  const previous = useRef(step);
  const [early, setEarly] = useState(false);

  // A changed step moves focus to its card's heading; the first render leaves
  // focus where it is (the composer).
  useEffect(() => {
    if (previous.current === step) return;
    previous.current = step;
    focusCurrentCard(state);
  }, [state, step]);

  const closeCalendars = (saved: boolean) => {
    setEditingCalendars(false);
    if (!saved) {
      window.requestAnimationFrame(() => document.getElementById(CHANGE_CALENDARS_ID)?.focus());
    }
  };

  const rolesEditor = editingCalendars ? <CalendarRolesCard onClose={closeCalendars} /> : null;

  switch (step) {
    case "connect_calendar":
      return (
        <>
          <ConnectCalendarCard />
          <Button
            aria-expanded={early}
            className="self-start"
            onClick={() => setEarly((current) => !current)}
            type="button"
            variant="ghost"
          >
            <ChevronDownIcon aria-hidden className={cn("transition-transform", early ? "rotate-180" : undefined)} />
            {early ? "Hide other preferences" : "Set other preferences now"}
          </Button>
          {early ? <PreferenceCards /> : null}
        </>
      );
    case "choose_calendars":
      return <CalendarRolesCard />;
    case "analyzing":
      return <AnalysisCard />;
    case "review_suggestions":
    case "confirm_settings":
      return (
        <>
          {rolesEditor}
          <AnalysisCard />
          <PreferenceCards />
          <ReviewCard />
        </>
      );
    case "ready":
      return (
        <>
          <ShareLinksCard />
          {rolesEditor}
          {state.pendingChanges ? (
            <>
              <p className="rounded-lg border border-warning/50 bg-card px-4 py-3 text-sm" role="status">
                <span className="font-medium text-warning">Changes not yet confirmed.</span> Your booking page still uses your
                confirmed settings.
              </p>
              <ReviewCard pending />
            </>
          ) : null}
        </>
      );
  }
}
