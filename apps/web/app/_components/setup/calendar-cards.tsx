"use client";

import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CardActions, SetupCard } from "./card";
import { accessLabel, calendarErrorText, canAddEvents } from "./format";
import { useSetup } from "./setup-context";

// Calendar connection and calendar roles (H4). Calendars are listed by provider
// identity with their account and access labels; two calendars with one name stay
// distinguishable, and only a calendar the host can write to can receive bookings.

export const CONNECT_CARD_ID = "setup-connect";
export const CALENDARS_CARD_ID = "setup-calendars";
export const CONSENT_HREF = "/auth/sign-in?consent=calendar";
const GOOGLE_CONNECTIONS = "https://myaccount.google.com/connections";

export function ConnectCalendarCard() {
  const { state } = useSetup();

  return (
    <SetupCard
      eyebrow="Google Calendar"
      id={CONNECT_CARD_ID}
      title="Connect Google Calendar"
      description={
        state.calendar.invalid
          ? "Your earlier Calendar access stopped working, so bookings are paused until you connect again."
          : null
      }
    >
      <p>
        One Google screen asks for Calendar access: reading the calendars you choose and adding bookings to one of them.
        You can grant it now; nothing is read until you pick calendars.
      </p>
      <CardActions>
        <Button asChild>
          <a href={CONSENT_HREF}>Connect Google Calendar</a>
        </Button>
      </CardActions>
      {state.account.googleEmail ? (
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="break-all text-foreground">{state.account.googleEmail}</span>
        </p>
      ) : null}
    </SetupCard>
  );
}

export function GoogleConnectionLinks() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <a
        className="inline-flex min-h-11 items-center gap-1.5 text-primary underline underline-offset-4"
        href={GOOGLE_CONNECTIONS}
        rel="noopener noreferrer"
        target="_blank"
      >
        Manage Google connection
        <ExternalLinkIcon aria-hidden className="size-3.5" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      <a className="inline-flex min-h-11 items-center gap-1.5 text-primary underline underline-offset-4" href={CONSENT_HREF}>
        <RefreshCwIcon aria-hidden className="size-3.5" />
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
      eyebrow="Calendars"
      footer={<GoogleConnectionLinks />}
      id={CALENDARS_CARD_ID}
      title="Choose your calendars"
      description="I check the calendars you choose for conflicts and add confirmed bookings to one of them."
    >
      {error ? (
        <div className="flex flex-col gap-3" role="status">
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
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <Spinner aria-hidden className="size-4" />
          Loading your calendars...
        </p>
      )}
    </SetupCard>
  );
}

function RolesForm({ onClose }: { readonly onClose?: (saved: boolean) => void }) {
  const { busy, run, state } = useSetup();
  const calendars = state.calendar.calendars ?? [];
  const recommendations = state.calendar.recommendations;
  const reasons = new Map(recommendations?.conflict.map((entry) => [entry.id, entry.reason]) ?? []);
  const listed = new Set(calendars.map((calendar) => calendar.id));
  const [conflict, setConflict] = useState<Set<string>>(() => {
    const saved = state.roles?.conflictCalendars.map((calendar) => calendar.id).filter((id) => listed.has(id));
    return new Set(saved?.length ? saved : (recommendations?.conflict.map((entry) => entry.id) ?? []));
  });
  const [booking, setBooking] = useState<string | null>(() => {
    const saved = state.roles?.bookingCalendar.id;
    const savedCalendar = calendars.find((calendar) => calendar.id === saved);
    if (savedCalendar && canAddEvents(savedCalendar.accessRole)) return savedCalendar.id;
    return recommendations?.booking?.id ?? null;
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

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 font-medium">Check for conflicts</legend>
        <p className="-mt-1 text-sm text-muted-foreground">Events on these calendars keep their times busy.</p>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {calendars.map((calendar) => {
            const checkboxId = `${id}-conflict-${calendar.id}`;
            const reason = reasons.get(calendar.id);
            return (
              <li className="px-3 py-2" key={calendar.id}>
                <label className="flex min-h-11 items-start gap-3" htmlFor={checkboxId}>
                  <input
                    checked={conflict.has(calendar.id)}
                    className="mt-1 size-5 shrink-0 accent-primary"
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
                  <CalendarLabel accessRole={calendar.accessRole} id={calendar.id} primary={calendar.primary} reason={reason} summary={calendar.summary} />
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 font-medium">Add bookings to</legend>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {calendars.map((calendar) => {
            const radioId = `${id}-booking-${calendar.id}`;
            const writable = canAddEvents(calendar.accessRole);
            const reason =
              writable && recommendations?.booking?.id === calendar.id
                ? `Recommended: ${recommendations.booking.reason}`
                : writable
                  ? undefined
                  : `${accessLabel(calendar.accessRole)} — can't add events`;
            return (
              <li className="px-3 py-2" key={calendar.id}>
                <label className={writable ? "flex min-h-11 items-start gap-3" : "flex min-h-11 items-start gap-3 text-muted-foreground"} htmlFor={radioId}>
                  <input
                    checked={booking === calendar.id}
                    className="mt-1 size-5 shrink-0 accent-primary"
                    disabled={!writable}
                    id={radioId}
                    name={`${id}-booking`}
                    onChange={() => setBooking(calendar.id)}
                    type="radio"
                    value={calendar.id}
                  />
                  <CalendarLabel accessRole={calendar.accessRole} id={calendar.id} primary={calendar.primary} reason={reason} summary={calendar.summary} />
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {problem ? (
        <p className="text-sm text-destructive" id={`${id}-problem`} role="status">
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

// A calendar's name, primary badge, access label, account identity and reason;
// the identity is what tells two calendars with one name apart.
function CalendarLabel({
  accessRole,
  id,
  primary,
  reason,
  summary,
}: {
  readonly accessRole: string;
  readonly id: string;
  readonly primary?: boolean;
  readonly reason?: string;
  readonly summary: string;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium break-all text-foreground">{summary}</span>
        {primary ? (
          <span className="rounded-full border border-input px-2 py-0.5 text-xs font-medium text-foreground">Primary</span>
        ) : null}
      </span>
      <span className="text-sm text-muted-foreground">
        <span className="font-medium">{accessLabel(accessRole)}</span>
        <span aria-hidden> · </span>
        <span className="sr-only">, </span>
        <span className="font-mono text-xs break-all">{id}</span>
      </span>
      {reason ? <span className="text-sm text-muted-foreground">{reason}</span> : null}
    </span>
  );
}
