import type { RequestState } from "@lib/contracts/request";
import type { OpenRequesterView } from "@lib/contracts/requester-view";

// What the booking page's composer says and whether it is usable
// (guest-flow-completion U9; #373). Before the fixed steps first hand over to
// Thyme it is shown but locked, pointing at the open step above. Once handed
// over it stays usable: a Calendar step that reopens later (a second Google
// sign-in, Change your calendar, a host profile's calendars removed) is the
// open card in the thread with Thyme's line about it, and the guest can keep
// writing meanwhile. A locked composer never points at a step that is not
// open, and a request that has ended says why the chat is closed.

// The closed request's status line, on the closed booking page and in the
// composer of a request that ends while its page is open.
export const CLOSED_TEXT: Readonly<Partial<Record<RequestState, string>>> = {
  booked: "This meeting is booked. Check your calendar for the details.",
  cancelled: "This meeting was cancelled.",
  declined: "The host declined this request.",
  expired: "This request expired before a time was agreed and booked.",
  withdrawn: "You withdrew this request.",
};

// The composer's words until the fixed steps hand over to Thyme (U9).
export const COMPOSER_LOCKED = "Finish the step above, then you can write to Thyme here";

// Thyme's line above a Calendar step that reopened after the handover.
export const CALENDAR_REOPENED =
  "Your Calendar step is open again: connect your calendar or skip it on the card below, so I offer times that suit you. You can keep writing to me meanwhile.";

const STEP_KINDS = new Set(["identity", "review", "host_profile", "calendar"]);

export type ComposerState = {
  // Why the composer cannot be used yet, or null.
  readonly lockedReason: string | null;
  // Why the chat is closed for good, when the request has ended.
  readonly closedReason: string | undefined;
  // The Calendar step reopened after the handover: the thread says so.
  readonly calendarReopened: boolean;
};

export function guestComposerState(
  view: Pick<OpenRequesterView, "handedOver" | "request" | "thread">,
  now: Date = new Date(),
): ComposerState {
  const { state } = view.request;
  const ended =
    CLOSED_TEXT[state] !== undefined && state !== "booked"
      ? CLOSED_TEXT[state]
      : (state === "gathering" || state === "negotiating" || state === "awaiting_host_approval") && Date.parse(view.request.expiresAt) <= now.getTime()
        ? CLOSED_TEXT.expired
        : undefined;
  const calendarOpen = view.thread.some((card) => card.kind === "calendar" && card.status === "open");

  if (ended) return { calendarReopened: false, closedReason: ended, lockedReason: null };

  // Locked only before the first handover, and only while a fixed step is
  // there to finish.
  const stepOpen = view.thread.some((card) => card.status === "open" && STEP_KINDS.has(card.kind));
  return {
    calendarReopened: view.handedOver && calendarOpen,
    closedReason: undefined,
    lockedReason: !view.handedOver && stepOpen ? COMPOSER_LOCKED : null,
  };
}
