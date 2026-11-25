import type { ThreadCard } from "@lib/contracts/requester-view";
import { Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RequesterCardContext } from "@/app/_components/requester/cards";
import { CALENDAR_NOT_CONNECTED, meetingActionMode, threadEntries } from "./guest-workspace";
import { MeetingActions } from "./meeting-actions";

// The answered Calendar step's receipt (#424): continuing without Google is a
// choice, so the receipt names it and what comes next instead of "Skipped".
function calendarReceipt(text: "Connected" | "Skipped", state: "gathering" | "awaiting_host_approval") {
  const context = {
    bookingId: "booking",
    timezone: "Asia/Seoul",
    view: { connection: { calendar: text === "Connected" }, contact: { name: "Grace Hopper" }, request: { details: {}, state } },
  } as unknown as RequesterCardContext;
  const card: ThreadCard = { at: "2026-11-24T00:00:00.000Z", id: "calendar", kind: "calendar", receipt: { text }, status: "answered" };
  const noop = () => undefined;
  const { entries, panel } = threadEntries(context, [card], {
    choosingAgain: false,
    editing: false,
    handedOver: false,
    profile: { again: false, close: noop, reopen: noop },
    reopenedAt: null,
    send: async () => undefined,
  });
  const render = (list: typeof entries) => renderToStaticMarkup(<>{list.map((entry) => <Fragment key={entry.id}>{entry.node}</Fragment>)}</>);
  return { panel: render(panel), thread: render(entries) };
}

describe("Calendar receipt", () => {
  it("says a guest without a calendar will give their times, not that the step was skipped", () => {
    const { panel, thread } = calendarReceipt("Skipped", "gathering");

    expect(CALENDAR_NOT_CONNECTED).toBe("Not connected · You’ll tell Thyme your times");
    expect(thread).toContain("Not connected · You’ll tell Thyme your times");
    expect(thread).not.toContain("Skipped");
    expect(panel).toContain("Not connected");
    expect(panel).not.toContain("Skipped");
  });

  it("keeps the change action while times are chosen, and drops it after", () => {
    expect(calendarReceipt("Skipped", "gathering").thread).toContain('aria-label="Change your calendar"');
    expect(calendarReceipt("Skipped", "awaiting_host_approval").thread).not.toContain("Change your calendar");
  });

  it("still names a connected calendar", () => {
    expect(calendarReceipt("Connected", "gathering").thread).toContain("Connected Grace Hopper’s Calendar");
  });
});

describe("meeting action tabs", () => {
  it("starts after a request is sent and stays available through booking", () => {
    expect(meetingActionMode("gathering", false)).toBeNull();
    expect(meetingActionMode("negotiating", false)).toBeNull();
    expect(meetingActionMode("awaiting_host_approval", false)).toBe("pending");
    expect(meetingActionMode("booking", false)).toBe("booking");
    expect(meetingActionMode("negotiating", false, "requester")).toBe("changing");
    expect(meetingActionMode("negotiating", true)).toBe("changing");
  });

  it("uses the same visible actions while awaiting approval", () => {
    const html = renderToStaticMarkup(<MeetingActions bookingId="booking" mode="pending" revision={3} />);
    expect(html).toContain("Change meeting");
    expect(html).toContain("Cancel meeting");
  });
});
