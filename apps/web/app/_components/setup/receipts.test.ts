import { type DraftEntry, SETUP_FIELD_NAMES, type SetupFieldName } from "@lib/contracts/setup";
import { describe, expect, it } from "vitest";
import { deriveReceipts, interleave, type Receipt, stepReceipts } from "./receipts";

// Receipts come only from durable state: a draft field's acceptedAt and history,
// the roles' saved time, the scan's completion and the confirmation time. One
// card action makes one receipt; a later change marks the earlier one as changed.

type State = Parameters<typeof deriveReceipts>[0];

const T = (seconds: number) => new Date(Date.UTC(2026, 9, 20, 9, 0, seconds)).toISOString();

function stateWith(drafts: Partial<Record<SetupFieldName, DraftEntry>>, extra: Partial<State> = {}): State {
  const fields = Object.fromEntries(
    SETUP_FIELD_NAMES.map((field) => {
      const draft = drafts[field] ?? null;
      return [
        field,
        {
          draft,
          proposed: draft ? { accepted: draft.accepted, reason: null, sampleSize: null, source: draft.source, value: draft.value } : null,
          suggestion: null,
        },
      ];
    }),
  ) as unknown as State["fields"];

  return {
    analysis: null,
    analysisSkipped: false,
    confirmedAt: null,
    fields,
    missingFields: [],
    readiness: { displayName: null, handle: null, ready: false },
    roles: null,
    ...extra,
  };
}

const accepted = (value: unknown, at: string, extra: Partial<DraftEntry> = {}) =>
  ({ accepted: true, acceptedAt: at, source: "stated", value, ...extra }) as DraftEntry;

const brief = (receipts: readonly Receipt[]) => receipts.map((receipt) => `${receipt.label}: ${receipt.value}`);

describe("setup receipts", () => {
  it("makes one receipt per accepted answer, with its value and source", () => {
    const receipts = deriveReceipts(stateWith({ timezone: accepted("Asia/Seoul", T(10)) }));

    expect(receipts).toEqual([
      {
        at: T(10),
        changedTo: null,
        id: `step-timezone-${T(10)}`,
        kind: "step",
        label: "Time zone",
        source: "stated",
        step: "timezone",
        value: "Asia/Seoul",
      },
    ]);
  });

  it("never makes a receipt from a value the assistant drafted", () => {
    const drafted = { accepted: false, source: "stated", value: "online" } as DraftEntry;
    expect(deriveReceipts(stateWith({ durationMinutes: { accepted: false, source: "inferred", value: 45 }, meetingMode: drafted }))).toEqual([]);
  });

  it("keeps the earlier answer's receipt, marked as changed by the newer one", () => {
    const timezone = accepted("Asia/Seoul", T(50), {
      history: [{ acceptedAt: T(10), source: "starter_default", value: "UTC" }],
    });
    const [earlier, newer] = stepReceipts(stateWith({ timezone }), "timezone");

    expect(earlier).toMatchObject({ changedTo: newer!.id, source: "starter_default", value: "UTC" });
    expect(newer).toMatchObject({ changedTo: null, source: "stated", value: "Asia/Seoul" });
  });

  it("groups the fields one card action saved, and shows each later change with the step's values then", () => {
    const state = stateWith({
      bufferAfterMinutes: accepted(10, T(11), { source: "inferred" }),
      bufferBeforeMinutes: accepted(25, T(90), { history: [{ acceptedAt: T(11), source: "inferred", value: 10 }] }),
      durationMinutes: accepted(30, T(10), { source: "inferred" }),
    });
    const receipts = stepReceipts(state, "duration");

    expect(brief(receipts)).toEqual([
      "Meeting length: 30 min, 10 min before, 10 min after",
      "Meeting length: 30 min, 25 min before, 10 min after",
    ]);
    expect(receipts[0]).toMatchObject({ changedTo: receipts[1]!.id, source: "inferred" });
  });

  it("starts a new receipt when a field of the group is answered again, however soon", () => {
    const state = stateWith({
      bufferAfterMinutes: accepted(10, T(1)),
      bufferBeforeMinutes: accepted(10, T(1)),
      durationMinutes: accepted(45, T(3), { history: [{ acceptedAt: T(1), source: "stated", value: 30 }] }),
    });

    expect(brief(stepReceipts(state, "duration"))).toEqual([
      "Meeting length: 30 min, 10 min before, 10 min after",
      "Meeting length: 45 min, 10 min before, 10 min after",
    ]);
  });

  it("leaves an answer's receipt unchanged when the assistant later drafts over it", () => {
    const meetingMode = {
      accepted: false,
      history: [{ acceptedAt: T(10), source: "stated", value: "online" }],
      source: "stated",
      value: "in_person",
    } as DraftEntry;
    const receipts = deriveReceipts(stateWith({ meetingMode }));

    expect(brief(receipts)).toEqual(["Online or in person: Online"]);
    expect(receipts[0]!.changedTo).toBeNull();
  });

  it("shows this visit's skips until the step is answered", () => {
    const skipped = new Map([["limit", T(20)] as const]);

    expect(deriveReceipts(stateWith({}), skipped)).toMatchObject([{ kind: "skipped", label: "Weekly meeting limit", value: "Skipped" }]);
    expect(deriveReceipts(stateWith({ weeklyLimit: accepted(5, T(30)) }), skipped)).toMatchObject([
      { kind: "step", value: "At most 5 meetings a week" },
    ]);
  });

  it("orders the calendars, the scan, the answers and the confirmation by time", () => {
    const state = stateWith(
      { displayName: accepted("Ada", T(40)), handle: accepted("ada", T(41)), timezone: accepted("Asia/Seoul", T(30)) },
      {
        analysis: {
          calendars: [
            { id: "a", ok: true, summary: "A" },
            { id: "b", ok: true, summary: "B" },
            { id: "c", ok: null, summary: "C" },
          ],
          completedAt: T(20),
          createdAt: T(15),
          evidence: { meetingLoad: { sampleSize: 41 }, noteLike: { entries: [] } } as never,
          failureCategory: null,
          id: "scan-1",
          range: { end: "2026-11-17T00:00:00.000Z", start: "2026-09-22T00:00:00.000Z" },
          state: "completed",
        },
        confirmedAt: T(60),
        readiness: { displayName: "Ada", handle: "ada", ready: true },
        roles: {
          bookingCalendar: { accessRole: "owner", id: "a", summary: "Work" },
          conflictCalendars: [
            { accessRole: "owner", id: "a", summary: "Work" },
            { accessRole: "reader", id: "b", summary: "Team" },
          ],
          destinationVerifiedAt: T(60),
          revision: 1,
          savedAt: T(5),
        },
      },
    );

    expect(brief(deriveReceipts(state))).toEqual([
      "Calendars: Checks 2 calendars, books into Work",
      "Calendar scan: Read 3 calendars · 4 weeks back and ahead · 41 meetings",
      "Time zone: Asia/Seoul",
      "Booking page: Ada, /ada",
      "Settings confirmed: ",
    ]);
  });

  it("leaves out receipts of steps that no longer apply", () => {
    const state = stateWith({ location: accepted({ kind: "decide_per_meeting" }, T(20)), meetingMode: accepted("online", T(30)) });

    expect(brief(deriveReceipts(state))).toEqual(["Online or in person: Online"]);
  });
});

describe("interleaving receipts with messages", () => {
  const receipt = (id: string, at: string | null) => ({ at, id }) as Receipt;

  it("puts each receipt after the messages that started before it, and undated ones last", () => {
    const timeline = interleave(
      [
        { at: T(0), message: "hello" },
        { at: null, message: "reply" },
        { at: T(30), message: "later" },
      ],
      [receipt("a", T(10)), receipt("b", T(30)), receipt("c", null)],
    );

    expect(timeline.map((entry) => (entry.kind === "message" ? entry.message : entry.receipt.id))).toEqual([
      "hello",
      "reply",
      "a",
      "later",
      "b",
      "c",
    ]);
  });

  it("puts receipts from before any message first", () => {
    const timeline = interleave([{ at: T(50), message: "hi" }], [receipt("a", T(10))]);
    expect(timeline.map((entry) => entry.kind)).toEqual(["receipt", "message"]);
  });
});
