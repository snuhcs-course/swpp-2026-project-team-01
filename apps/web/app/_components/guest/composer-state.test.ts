import type { RequestState } from "@lib/contracts/request";
import type { ThreadCard } from "@lib/contracts/requester-view";
import { describe, expect, it } from "vitest";
import { CLOSED_TEXT, COMPOSER_LOCKED, guestComposerState } from "./composer-state";

// The booking page composer's lock (#373): locked only before the first
// handover and only while a fixed step is open, never pointing at a step that
// cannot be finished, and closed with a reason once the request has ended.

const NOW = new Date("2026-11-23T09:00:00Z");
const LATER = "2026-11-30T09:00:00Z";

function view(options: {
  readonly handedOver: boolean;
  readonly state?: RequestState;
  readonly expiresAt?: string;
  readonly thread: readonly Pick<ThreadCard, "kind" | "status">[];
}) {
  return {
    handedOver: options.handedOver,
    request: { details: {}, expiresAt: options.expiresAt ?? LATER, revision: 2, state: options.state ?? "gathering" },
    thread: options.thread.map((card, index) => ({ ...card, at: NOW.toISOString(), id: `${card.kind}:${index}` })),
  };
}

describe("guestComposerState", () => {
  it("locks before the first handover while the Calendar step is open", () => {
    expect(guestComposerState(view({ handedOver: false, thread: [{ kind: "calendar", status: "open" }] }), NOW)).toEqual({
      calendarReopened: false,
      closedReason: undefined,
      lockedReason: COMPOSER_LOCKED,
    });
  });

  it("stays usable when the Calendar step reopens after the handover, and says it reopened", () => {
    const state = guestComposerState(
      view({ handedOver: true, thread: [{ kind: "calendar", status: "open" }, { kind: "meeting", status: "answered" }] }),
      NOW,
    );

    expect(state.lockedReason).toBeNull();
    expect(state.calendarReopened).toBe(true);
  });

  it("never points at a step that is not open", () => {
    const state = guestComposerState(
      view({ handedOver: false, state: "awaiting_host_approval", thread: [{ kind: "calendar", status: "waiting" }] }),
      NOW,
    );

    expect(state.lockedReason).toBeNull();
    expect(state.calendarReopened).toBe(false);
  });

  it("is open once handed over with nothing reopened", () => {
    expect(guestComposerState(view({ handedOver: true, thread: [{ kind: "calendar", status: "answered" }, { kind: "times", status: "open" }] }), NOW)).toEqual({
      calendarReopened: false,
      closedReason: undefined,
      lockedReason: null,
    });
  });

  it("says why the chat is closed when the request has run out of time", () => {
    const state = guestComposerState(view({ expiresAt: "2026-11-23T08:59:59Z", handedOver: false, thread: [{ kind: "calendar", status: "open" }] }), NOW);

    expect(state).toEqual({ calendarReopened: false, closedReason: CLOSED_TEXT.expired, lockedReason: null });
  });

  it.each(["withdrawn", "declined", "cancelled"] as const)("says why the chat is closed for a %s request", (state) => {
    expect(guestComposerState(view({ handedOver: true, state, thread: [] }), NOW).closedReason).toBe(CLOSED_TEXT[state]);
  });
});
