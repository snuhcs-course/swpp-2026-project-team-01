import type { NoteReview, NoteReviewDecision, NoteReviewItem, NoteWeek } from "@lib/contracts/note-review";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoteReviewDone, NoteReviewWeek } from "./note-review";
import { layoutWeek } from "./note-week-layout";

// The week of Monday 2026-11-16 in Seoul (UTC+9).
const week: NoteWeek = {
  contextUnavailable: false,
  events: [
    { allDay: false, end: "2026-11-16T02:00:00.000Z", id: "0", start: "2026-11-16T01:00:00.000Z", title: "팀 회의" },
    { allDay: false, end: "2026-11-18T07:00:00.000Z", id: "1", start: "2026-11-18T06:00:00.000Z", title: "1:1" },
  ],
  next: "2026-11-23",
  previous: null,
  start: "2026-11-16",
  timezone: "Asia/Seoul",
  today: "2026-11-16",
};

function item(overrides: Partial<NoteReviewItem> & { title: string }): NoteReviewItem {
  const start = overrides.start ?? "2026-11-17T10:00:00.000Z";
  const end = overrides.end ?? "2026-11-17T11:00:00.000Z";
  const allDay = overrides.allDay ?? false;
  return {
    allDay,
    calendarName: "host@example.test",
    decision: null,
    end,
    key: `key-${overrides.title}`,
    occurrences: [{ allDay, end, id: `occ-${overrides.title}`, start }],
    reason: null,
    repeats: false,
    start,
    verdict: null,
    writable: true,
    ...overrides,
  };
}

const items: NoteReviewItem[] = [
  item({ allDay: true, end: "2026-11-19", reason: "기억해 둘 메모처럼 보여요.", start: "2026-11-18", title: "엄마 생일", verdict: "note" }),
  // Tuesday 19:00 Seoul.
  item({ title: "헬스", verdict: "event" }),
  // Next week only.
  item({ end: "2026-11-24T06:00:00.000Z", start: "2026-11-24T05:00:00.000Z", title: "스터디", verdict: "unsure" }),
  item({ allDay: true, end: "2026-11-21", start: "2026-11-20", title: "과제 마감", verdict: "note" }),
];

const review: NoteReview = { analysisId: "00000000-0000-4000-8000-000000000001", decisions: [], items, slotImageWaits: false, state: "ready", week };

function render(value: NoteReview, locale: "en" | "ko" = "ko") {
  return renderToStaticMarkup(<NoteReviewWeek locale={locale} onConfirm={() => {}} review={value} />);
}

function text(markup: string) {
  return markup.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'");
}

// A candidate block's markup, by its occurrence.
function block(html: string, occurrence: string) {
  const at = html.indexOf(`data-note-occurrence="${occurrence}"`);
  if (at === -1) return null;
  return html.slice(html.lastIndexOf("<label", at), html.indexOf("</label>", at));
}

const checked = (markup: string | null) => /<input[^>]*checked=""[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*checked=""/.test(markup ?? "");

describe("layoutWeek", () => {
  it("puts all-day entries under the headings and timed ones on their local day and minute", () => {
    const layout = layoutWeek(week, items);
    const day = (date: string) => layout.days.find((entry) => entry.date === date)!;

    expect(day("2026-11-18").allDay.map((entry) => entry.title)).toEqual(["엄마 생일"]);
    expect(day("2026-11-17").timed).toEqual([expect.objectContaining({ endMinute: 20 * 60, kind: "candidate", startMinute: 19 * 60, title: "헬스" })]);
    expect(day("2026-11-16").timed).toEqual([expect.objectContaining({ kind: "busy", startMinute: 10 * 60, title: "팀 회의" })]);
    // The next week's entry is not in this week.
    expect([...layout.itemKeys].sort()).toEqual(["key-과제 마감", "key-엄마 생일", "key-헬스"]);
    expect(layout.firstHour).toBe(8);
    expect(layout.lastHour).toBe(22);
  });

  it("sets overlapping entries side by side", () => {
    const layout = layoutWeek(
      { ...week, events: [{ allDay: false, end: "2026-11-17T11:30:00.000Z", id: "0", start: "2026-11-17T10:30:00.000Z", title: "Dinner" }] },
      [items[1]!],
    );
    const lanes = layout.days.find((entry) => entry.date === "2026-11-17")!.timed.map((entry) => [entry.title, entry.lane, entry.lanes]);
    expect(lanes).toEqual([["헬스", 0, 2], ["Dinner", 1, 2]]);
  });
});

describe("NoteReviewWeek", () => {
  it("draws the week with a checkbox on each candidate, checked when recommended as notes, and the other plans in grey", () => {
    const html = render(review);

    expect(block(html, "occ-엄마 생일")).toContain('data-note-block="free"');
    expect(checked(block(html, "occ-엄마 생일"))).toBe(true);
    expect(checked(block(html, "occ-과제 마감"))).toBe(true);
    expect(block(html, "occ-헬스")).toContain('data-note-block="busy"');
    expect(checked(block(html, "occ-헬스"))).toBe(false);
    // The classifier's reason is the block's tooltip.
    expect(block(html, "occ-엄마 생일")).toContain('title="엄마 생일 · 기억해 둘 메모처럼 보여요."');
    expect(block(html, "occ-스터디")).toBeNull();
    expect(html.match(/data-note-busy/g)).toHaveLength(2);
    expect(text(html)).toContain("팀 회의");
    // All-day entries sit in the row under the headings.
    expect(html.slice(html.indexOf('data-note-all-day="2026-11-18"'))).toMatch(/^[^]*?엄마 생일/);
  });

  it("puts nothing between the week and the confirm button", () => {
    const html = render(review, "en");
    const between = html.slice(html.indexOf("data-note-week-grid"), html.indexOf(">Confirm</button>"));

    expect(between).not.toContain("data-note-panel");
    expect(between).not.toContain("data-note-google-notice");
    expect(text(between)).not.toContain("Times in");
  });

  it("offers the next week but not one before this week", () => {
    const html = render(review);
    expect(html).toMatch(/<button[^>]*aria-label="이전 주"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*aria-label="다음 주"[^>]*disabled=""/);
  });

  it("shows no words when there is nothing to check", () => {
    const html = render({ ...review, items: [] });
    expect(text(html)).toBe("");
    expect(html).not.toContain("<button");
  });

  it("starts from the host's answers, so the week can be changed after Confirm", () => {
    const answered = render({
      ...review,
      items: [
        item({ decision: "keep_busy", title: "헬스", verdict: "note" }),
        item({ allDay: true, decision: "free", end: "2026-11-19", start: "2026-11-18", title: "엄마 생일", verdict: "event" }),
      ],
    });
    expect(checked(block(answered, "occ-헬스"))).toBe(false);
    expect(checked(block(answered, "occ-엄마 생일"))).toBe(true);
  });
});

describe("NoteReviewDone", () => {
  it("lists only the freed entries with their day and time under a quiet Google line, words only for a failure, and Back", () => {
    const decision = (
      id: string,
      writebackState: NoteReviewDecision["writebackState"],
      time: Pick<NoteReviewDecision, "allDay" | "end" | "start">,
      decided: "free" | "keep_busy" = "free",
    ): NoteReviewDecision => ({
      ...time,
      calendarName: "host@example.test",
      decision: decided,
      id,
      scope: "occurrence",
      title: id,
      updatedAt: "2026-11-13T00:00:00.000Z",
      writebackFailure: writebackState === "failed" ? "calendar_rejected" : null,
      writebackState,
    });
    const timed = { allDay: false, end: "2026-11-17T13:00:00.000Z", start: "2026-11-17T12:00:00.000Z" };
    const html = renderToStaticMarkup(
      <NoteReviewDone
        exit={{ channel: "whatsapp", href: "https://wa.me/15550002222" }}
        locale="en"
        onBack={() => {}}
        onRetry={() => {}}
        review={{
          ...review,
          decisions: [
            decision("birthday", "done", { allDay: true, end: "2026-11-19", start: "2026-11-18" }),
            decision("recycling", "pending", timed),
            decision("failed", "failed", timed),
            decision("kept", null, timed, "keep_busy"),
          ],
          items: [],
        }}
      />,
    );
    const rows = html
      .split("</ul>")[0]!
      .split("<li")
      .filter((part) => part.includes("data-note-decision"))
      .map((part) => text(`<li${part}`));

    expect(text(html)).toContain("Marked as freeSaved to Google Calendar.");
    expect(rows).toEqual([
      "birthdayWed, Nov 18 · All day",
      "recyclingTue, Nov 17 · 9:00 PM–10:00 PM",
      "failedTue, Nov 17 · 9:00 PM–10:00 PMCouldn't update Google Calendar. It stays busy.Try again",
    ]);
    expect(text(html)).toContain("Back");
    expect(html).toMatch(/<a[^>]*href="https:\/\/wa\.me\/15550002222"[^>]*>Back to WhatsApp<\/a>/);
    expect(html).not.toContain("data-note-slot-image");
  });

  it("says the open times follow by message only when the chat onboarding waits for them", () => {
    const done = (slotImageFollows: boolean) =>
      renderToStaticMarkup(
        <NoteReviewDone
          exit={{ channel: "imessage", href: "sms:+15550002222" }}
          locale="ko"
          onBack={() => {}}
          review={{ ...review, decisions: [], items: [] }}
          slotImageFollows={slotImageFollows}
        />,
      );
    expect(text(done(true))).toContain("가능한 시간을 메시지로 보내드릴게요.");
    expect(done(false)).not.toContain("data-note-slot-image");
  });
});
