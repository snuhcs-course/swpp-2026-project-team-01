"use client";

import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { CardActions, QuietButton, SetupCard } from "./card";
import { accessLabel, calendarErrorText, canAddEvents } from "./format";
import { useSetup } from "./setup-context";

// Calendar connection and calendar roles (H4). Calendars are listed compactly by
// name and access; an ID shows only when two calendars share a name, so they stay
// distinguishable, and only a calendar the host can write to is offered for
// bookings.

export const CONNECT_CARD_ID = "setup-connect";
export const CALENDARS_CARD_ID = "setup-calendars";
export const CONSENT_HREF = "/auth/sign-in?consent=calendar";
const GOOGLE_CONNECTIONS = "https://myaccount.google.com/connections";

export function ConnectCalendarCard({ onSetOtherPreferences }: { readonly onSetOtherPreferences?: () => void }) {
  const { state } = useSetup();

  return (
    <SetupCard
      description={
        state.calendar.invalid
          ? "Your earlier Calendar access stopped working, so bookings are paused until you connect again."
          : "Nothing is read until you pick calendars."
      }
      id={CONNECT_CARD_ID}
      label="Google Calendar"
      title="Connect Google Calendar"
    >
      <p>One Google screen asks to read the calendars you choose and add bookings to one of them.</p>
      <CardActions>
        <Button asChild>
          <a href={CONSENT_HREF}>Connect Google Calendar</a>
        </Button>
        {onSetOtherPreferences ? <QuietButton onClick={onSetOtherPreferences}>Set other preferences now</QuietButton> : null}
      </CardActions>
      {state.account.googleEmail ? (
        <p className="text-xs text-muted-foreground">
          Signed in as <span className="break-all text-foreground">{state.account.googleEmail}</span>
        </p>
      ) : null}
    </SetupCard>
  );
}

export function GoogleConnectionLinks() {
  const link = "inline-flex min-h-9 items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground";
  return (
    <div className="flex flex-wrap items-center gap-x-4">
      <a className={link} href={GOOGLE_CONNECTIONS} rel="noopener noreferrer" target="_blank">
        Manage Google connection
        <ExternalLinkIcon aria-hidden className="size-3" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      <a className={link} href={CONSENT_HREF}>
        <RefreshCwIcon aria-hidden className="size-3" />
        Reconnect Google Calendar
      </a>
    </div>
  );
}

export function CalendarRolesCard({ onClose }: { readonly onClose?: (saved: boolean) => void }) {
  const { state } = useSetup();
  const { calendars, error } = state.calendar;

  return (
    <SetupCard
      description={
        state.calendar.destinationLost
          ? "Your booking calendar can no longer take new events, so bookings are paused."
          : "I check these for conflicts and add bookings to one."
      }
      id={CALENDARS_CARD_ID}
      label="Calendars"
      title="Choose your calendars"
    >
      {error ? (
        <div className="flex flex-col gap-2" role="status">
          <p>{calendarErrorText(error)}</p>
          {onClose ? (
            <CardActions>
              <Button onClick={() => onClose(false)} type="button" variant="outline">
                Cancel calendar edits
              </Button>
            </CardActions>
          ) : null}
        </div>
      ) : calendars ? (
        <RolesForm key={calendars.map((calendar) => calendar.id).join("|")} onClose={onClose} />
      ) : (
        <p role="status">
          <span className="shimmer text-muted-foreground motion-reduce:shimmer-none">Loading your calendars...</span>
        </p>
      )}
      <GoogleConnectionLinks />
    </SetupCard>
  );
}

function RolesForm({ onClose }: { readonly onClose?: (saved: boolean) => void }) {
  const { busy, run, state } = useSetup();
  const calendars = state.calendar.calendars ?? [];
  const recommendations = state.calendar.recommendations;
  const reasons = new Map(recommendations?.conflict.map((entry) => [entry.id, entry.reason]) ?? []);
  const listed = new Set(calendars.map((calendar) => calendar.id));
  // Names held by more than one calendar, whose IDs are shown to tell them apart.
  const shared = new Set(
    calendars.map((calendar) => calendar.summary).filter((name, index, names) => names.indexOf(name) !== index),
  );
  const writable = calendars.filter((calendar) => canAddEvents(calendar.accessRole));
  const [conflict, setConflict] = useState<Set<string>>(() => {
    const saved = state.roles?.conflictCalendars.map((calendar) => calendar.id).filter((id) => listed.has(id));
    return new Set(saved?.length ? saved : (recommendations?.conflict.map((entry) => entry.id) ?? []));
  });
  const [booking, setBooking] = useState<string>(() => {
    const saved = state.roles?.bookingCalendar.id;
    if (saved && writable.some((calendar) => calendar.id === saved)) return saved;
    return recommendations?.booking?.id ?? "";
  });
  const id = useId();
  const saving = busy === CALENDARS_CARD_ID;
  const problem =
    conflict.size === 0 ? "Choose at least one calendar to check for conflicts." : !booking ? "Choose where to add bookings." : null;

  const save = async () => {
    if (problem || !booking) return;
    const saved = await run(CALENDARS_CARD_ID, [
      {
        // None saved yet is revision 0.
        expectedRevision: state.roles?.revision ?? 0,
        input: {
          bookingCalendarId: booking,
          conflictCalendarIds: calendars.filter((calendar) => conflict.has(calendar.id)).map((calendar) => calendar.id),
        },
        operation: "setup.save_calendar_roles",
      },
    ]);
    if (saved) onClose?.(true);
  };

  if (calendars.length === 0) {
    return <p role="status">No calendars came back from Google. Reconnect Google Calendar, then try again.</p>;
  }

  const optionName = (calendar: (typeof calendars)[number]) =>
    `${calendar.summary}${shared.has(calendar.summary) ? ` (${calendar.id})` : ""}${
      recommendations?.booking?.id === calendar.id ? " — recommended" : ""
    }`;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <FieldSet className="min-w-0 gap-0">
        <FieldLegend className="mb-1.5" variant="label">
          Check for conflicts
        </FieldLegend>
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
        {calendars.map((calendar) => {
          const checkboxId = `${id}-conflict-${calendar.id}`;
          const reason = reasons.get(calendar.id);
          return (
            <FieldLabel className="rounded-none border-0! font-normal" htmlFor={checkboxId} key={calendar.id}>
              <Field className="min-h-11 items-center! gap-3 px-3! py-1.5!" orientation="horizontal">
                <input
                  checked={conflict.has(calendar.id)}
                  className="size-5 shrink-0 accent-primary"
                  id={checkboxId}
                  onChange={(event) =>
                    setConflict((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(calendar.id);
                      else next.delete(calendar.id);
                      return next;
                    })
                  }
                  type="checkbox"
                />
                <FieldContent className="min-w-0 gap-0">
                  <FieldTitle className="w-full min-w-0">
                    <span className="truncate">{calendar.summary}</span>
                    {calendar.primary ? (
                      <span className="shrink-0 rounded-full border border-input px-1.5 text-xs font-medium">Primary</span>
                    ) : null}
                  </FieldTitle>
                  {shared.has(calendar.summary) ? (
                    <FieldDescription className="truncate font-mono text-xs">
                      <span className="sr-only">, </span>
                      {calendar.id}
                    </FieldDescription>
                  ) : null}
                  {reason && !shared.has(calendar.summary) ? (
                    <FieldDescription className="truncate text-xs" title={reason}>
                      <span className="sr-only">, </span>
                      {reason}
                    </FieldDescription>
                  ) : reason ? (
                    <span className="sr-only">, {reason}</span>
                  ) : null}
                </FieldContent>
                <span className="shrink-0 text-xs text-muted-foreground">
                  <span className="sr-only">, </span>
                  {accessLabel(calendar.accessRole)}
                </span>
              </Field>
            </FieldLabel>
          );
        })}
        </div>
      </FieldSet>

      <Field className="min-w-0 gap-1">
        <FieldLabel htmlFor={`${id}-booking`}>Add bookings to</FieldLabel>
        {writable.length > 0 ? (
          <select
            className="h-11 w-full min-w-0 truncate rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:border-ring"
            id={`${id}-booking`}
            onChange={(event) => setBooking(event.target.value)}
            value={booking}
          >
            {booking ? null : (
              <option disabled value="">
                Choose a calendar
              </option>
            )}
            {writable.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {optionName(calendar)}
              </option>
            ))}
          </select>
        ) : (
          <FieldDescription>None of your calendars can take new events. Reconnect Google Calendar or share one with edit access.</FieldDescription>
        )}
      </Field>

      {problem ? (
        <p className="text-destructive" id={`${id}-problem`} role="status">
          {problem}
        </p>
      ) : null}
      <CardActions>
        <Button aria-describedby={problem ? `${id}-problem` : undefined} disabled={Boolean(problem) || busy !== null} type="submit">
          {saving ? "Saving..." : "Save calendars"}
        </Button>
        {onClose ? (
          <Button onClick={() => onClose(false)} type="button" variant="outline">
            Cancel calendar edits
          </Button>
        ) : null}
      </CardActions>
    </form>
  );
}
