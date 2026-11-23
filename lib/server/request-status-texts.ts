import type { RequestState } from "../contracts/request";

// The status and next-step texts the guest assistant reads in read_request,
// read_booking_status and evaluate_candidates. They say what the request's
// state allows, so the model offers only decisions the commands accept
// (guest-assistant-story-fixes, #277 and #278).

// Where a booked meeting stands against the clock. The cancel and change
// commands refuse a meeting whose start has passed (booking-cancellation.ts).
export type MeetingPhase = "upcoming" | "started" | "ended";

export function meetingPhase(time: { readonly start: string; readonly end: string }, now: Date): MeetingPhase {
  if (new Date(time.end).getTime() <= now.getTime()) return "ended";
  if (new Date(time.start).getTime() <= now.getTime()) return "started";
  return "upcoming";
}

export const STATUS_TEXT: Readonly<Record<RequestState, string>> = {
  draft: "Not yet a request: the guest has not given a name and email. The host cannot see it.",
  awaiting_host_approval: "The requester agreed to the proposal; it waits for the host's approval. Nothing is booked.",
  booked:
    "Booked: the meeting is confirmed. Answer questions about it from booking. Until it starts, the guest can cancel it with cancel_booking after confirming once, or change its time or place: change_booking reopens it, and the meeting stays booked until the host approves the change.",
  booking:
    "The host approved and the meeting is being booked. Nothing can change here until it is booked: no time, place or detail changes, and no tool reopens it. Once it is booked, the guest can change its time or place or cancel it here, until it starts.",
  cancelled: "The booked meeting was cancelled and the request is closed. The calendar event is removed. The guest can write again later to ask for a new meeting.",
  declined: "The host declined. The request is closed.",
  expired: "The request expired and is closed.",
  gathering: "Gathering meeting details. Nothing is proposed or booked.",
  negotiating: "Choosing a time. Nothing is agreed or booked.",
  withdrawn: "The requester withdrew. The request is closed.",
};

const STARTED_TEXT: Readonly<Record<Exclude<MeetingPhase, "upcoming">, string>> = {
  started:
    "Booked, and the meeting has already started (see now). It can no longer be cancelled or changed here: do not offer or ask to cancel or change it. Answer questions about it from booking.",
  ended:
    "Booked, and the meeting has already ended (see now). It can no longer be cancelled or changed here. Answer questions about it from booking; for another meeting, the guest can write again later.",
};

// While a change to a booked meeting is being booked, the meeting that stands
// can still be cancelled (booking-cancellation.ts); only the change is fixed.
const CHANGE_BOOKING_TEXT =
  "The host approved the change and the new version is being booked. The change itself can no longer be edited here: no time, place or detail changes, and no tool reopens it. The booked meeting in booking still stands until the new version is booked.";

export function statusText(state: RequestState, phase: MeetingPhase | null, changing = false) {
  if (state === "booking" && changing) return CHANGE_BOOKING_TEXT;
  return state === "booked" && phase && phase !== "upcoming" ? STARTED_TEXT[phase] : STATUS_TEXT[state];
}

export const CHANGE_NOTE =
  "A change to the booked meeting is open: booking holds the meeting that stands until the host approves the new version. If the guest no longer wants the change, withdraw_request drops it and keeps the booked meeting; cancel_booking cancels the meeting itself.";

const DECIDE_ONLY_WHEN_CLEAR =
  "Record a decision only when the guest clearly made it, about the exact time or version they named; when it is unclear, ask.";

const OPEN_STEPS = `The guest decides on the booking page's cards or in words: apply_request_review applies the pending review and finds times, choose_time chooses one of the current candidate times, agree_to_proposal agrees to the current proposal, and withdraw_request withdraws the request. ${DECIDE_ONLY_WHEN_CLEAR}`;

const NO_STEPS = "No decision tool applies in this state: answer from the status and do not call one.";

// What the guest can decide now, by state: only the tools its commands accept.
// changing: the request is reopened from a booked meeting that still stands.
export function nextSteps(state: RequestState, phase: MeetingPhase | null = null, changing = false): string {
  switch (state) {
    case "draft":
    case "gathering":
    case "negotiating":
      return OPEN_STEPS;
    case "awaiting_host_approval":
      return `The request waits for the host's approval. change_agreement reopens it if the guest wants to change its details or time (a new time then needs a new agreement), and withdraw_request withdraws it. ${DECIDE_ONLY_WHEN_CLEAR}`;
    case "booking":
      if (changing) {
        const cancel =
          phase && phase !== "upcoming"
            ? "The booked meeting has started, so do not call cancel_booking."
            : "cancel_booking cancels the booked meeting itself after the guest confirms once.";
        return `The approved change is being booked: do not call change_agreement or change_booking. ${cancel} withdraw_request drops the change and keeps the booked meeting. Either may report that the new booking is already being written; then say so. ${DECIDE_ONLY_WHEN_CLEAR}`;
      }
      return `Nothing can be decided here until the meeting is booked: do not call change_agreement, change_booking or cancel_booking. ${NO_STEPS}`;
    case "booked":
      return phase && phase !== "upcoming"
        ? `The meeting has started, so it can no longer be cancelled or changed: do not call cancel_booking or change_booking. ${NO_STEPS}`
        : `cancel_booking cancels the meeting after the guest confirms once; change_booking reopens it for another time or place while it stays booked. ${DECIDE_ONLY_WHEN_CLEAR}`;
    default:
      return `The request is closed. ${NO_STEPS}`;
  }
}

// The current local date and time in the requester's timezone, with the
// weekday, so the model can tell whether a booked meeting has started.
export function localNow(timezone: string, now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${parts.weekday})`;
}
