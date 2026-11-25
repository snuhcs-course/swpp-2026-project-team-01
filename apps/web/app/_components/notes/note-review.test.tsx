import type { NoteReview, NoteReviewDecision, NoteReviewItem, NoteWeek } from "@lib/contracts/note-review";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { confirmedChoices, NoteEntryDetails, NoteReviewDone, NoteReviewWeek } from "./note-review";
import { NOTE_REVIEW_COPY } from "./note-review-copy";
import { candidateKeys, firstWindow, layoutWeek, stepWindow, windowWeeks } from "./note-week-layout";

// The week of Monday 2026-11-16 in Seoul (UTC+9).
const week: NoteWeek = {
  contextUnavailable: false,
  events: [
    { allDay: false, description: "회의실 3층", end: "2026-11-16T02:00:00.000Z", id: "0", start: "2026-11-16T01:00:00.000Z", title: "팀 회의" },
    { allDay: false, description: null, end: "2026-11-18T07:00:00.000Z", id: "1", start: "2026-11-18T06:00:00.000Z", title: "1:1" },
  ],
  descriptions: [{ description: "준비물: 운동화", key: "key-헬스", occurrence: "occ-헬스" }],
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

function render(value: NoteReview, locale: "en" | "ko" = "ko", phone?: boolean) {
  return renderToStaticMarkup(<NoteReviewWeek locale={locale} onConfirm={() => {}} phone={phone} review={value} />);
}

function text(markup: string) {
  return markup.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'");
}

// A candidate block's markup, by its occurrence: its checkbox and its entry button.
function block(html: string, occurrence: string) {
  const at = html.indexOf(`data-note-occurrence="${occurrence}"`);
  if (at === -1) return null;
  return html.slice(html.lastIndexOf("<div", at), html.indexOf("</button>", at) + "</button>".length);
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
      { ...week, events: [{ allDay: false, description: null, end: "2026-11-17T11:30:00.000Z", id: "0", start: "2026-11-17T10:30:00.000Z", title: "Dinner" }] },
      [items[1]!],
    );
    const lanes = layout.days.find((entry) => entry.date === "2026-11-17")!.timed.map((entry) => [entry.title, entry.lane, entry.lanes]);
    expect(lanes).toEqual([["헬스", 0, 2], ["Dinner", 1, 2]]);
  });

  it("carries each entry's description for its details, a candidate's by its occurrence", () => {
    const layout = layoutWeek(week, items);
    const blocks = layout.days.flatMap((day) => [...day.allDay, ...day.timed]);
    const of = (title: string) => blocks.find((entry) => entry.title === title)!.description;

    expect(of("헬스")).toBe("준비물: 운동화");
    expect(of("팀 회의")).toBe("회의실 3층");
    expect(of("1:1")).toBeNull();
    expect(of("엄마 생일")).toBeNull();
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

  it("makes each entry a details button apart from its checkbox, so only the checkbox toggles", () => {
    const html = render(review, "en");
    const health = block(html, "occ-헬스")!;
    const checkbox = /<label[^>]*data-note-check[^>]*>(<input[^>]*>)<\/label>/.exec(health);
    const entry = /<button[^>]*data-note-entry[^>]*>/.exec(health)?.[0] ?? "";

    // The checkbox sits in its own label, keeps its name, and holds no button.
    expect(checkbox?.[1]).toMatch(/aria-label="헬스 7:00 PM"/);
    expect(checkbox?.[1]).toMatch(/type="checkbox"/);
    // The entry is a separate button, collapsed until pressed, named for its details,
    // and outside the label, so pressing it cannot reach the checkbox.
    expect(entry).toMatch(/aria-expanded="false"/);
    expect(entry).toMatch(/aria-haspopup="dialog"/);
    expect(entry).toMatch(/aria-label="헬스 7:00 PM, Details"/);
    expect(entry).toMatch(/type="button"/);
    expect(health.indexOf("data-note-entry")).toBeGreaterThan(health.indexOf("</label>"));
    // Grey context entries open their details the same way, with no checkbox.
    const busy = html.slice(html.indexOf("data-note-busy"), html.indexOf("</button>", html.indexOf("data-note-busy")));
    expect(busy).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-label="팀 회의 10:00 AM, Details"|<button[^>]*aria-label="팀 회의 10:00 AM, Details"[^>]*aria-expanded="false"/);
    expect(busy).not.toContain('type="checkbox"');
    // The details stay closed until an entry is pressed.
    expect(html).not.toContain("data-note-details");
  });

  it("shows only the title on an entry of 30 minutes or less, keeping the time in its name", () => {
    // Thursday 10:00, 12:00 and 14:00 Seoul.
    const short = [
      item({ end: "2026-11-19T01:20:00.000Z", start: "2026-11-19T01:00:00.000Z", title: "20분" }),
      item({ end: "2026-11-19T03:30:00.000Z", start: "2026-11-19T03:00:00.000Z", title: "30분" }),
      item({ end: "2026-11-19T05:45:00.000Z", start: "2026-11-19T05:00:00.000Z", title: "45분" }),
    ];
    const html = render({ ...review, items: short }, "en");
    const entry = (title: string) => {
      const markup = block(html, `occ-${title}`)!;
      // The entry button's visible text, after its opening tag.
      return text(markup.slice(markup.indexOf(">", markup.indexOf("data-note-entry")) + 1));
    };

    expect(entry("20분")).not.toContain("10:00 AM");
    expect(entry("30분")).not.toContain("12:00 PM");
    expect(entry("45분")).toContain("2:00 PM");
    expect(block(html, "occ-20분")).toContain('aria-label="20분 10:00 AM, Details"');
  });

  it("gives the checkbox a corner of its own, at least 24px and larger on a touch screen", () => {
    const health = block(render(review, "en", true), "occ-헬스")!;
    expect(health).toMatch(/<label[^>]*class="[^"]*size-6[^"]*pointer-coarse:size-7[^"]*"[^>]*data-note-check/);
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

describe("the phone view, three days at a time", () => {
  it("opens on today and moves three days at a time, never before today", () => {
    expect(firstWindow(week)).toBe("2026-11-16");
    // A later week opens on its Monday; a kept day comes back.
    expect(firstWindow({ start: "2026-11-23", today: "2026-11-16" })).toBe("2026-11-23");
    expect(firstWindow(week, "2026-11-19")).toBe("2026-11-19");
    expect(firstWindow({ start: "2026-11-16", today: "2026-11-18" }, "2026-11-16")).toBe("2026-11-18");

    expect(stepWindow("2026-11-16", 1, "2026-11-16", week)).toBe("2026-11-19");
    expect(stepWindow("2026-11-16", -1, "2026-11-16", week)).toBeNull();
    expect(stepWindow("2026-11-20", -1, "2026-11-16", week)).toBe("2026-11-17");
    expect(stepWindow("2026-11-18", -1, "2026-11-16", week)).toBe("2026-11-16");
  });

  it("crosses into the next week, asks for each week its days reach, and stops at the last week's Sunday", () => {
    // Thursday to Saturday, then Sunday to Tuesday of the next week.
    expect(stepWindow("2026-11-19", 1, "2026-11-16", week)).toBe("2026-11-22");
    expect(windowWeeks("2026-11-22")).toEqual(["2026-11-16", "2026-11-23"]);
    expect(windowWeeks("2026-11-16")).toEqual(["2026-11-16"]);
    // In the scan's last week, the view ends on its Sunday.
    const last = { next: null, start: "2026-12-07" };
    expect(stepWindow("2026-12-08", 1, "2026-11-16", last)).toBe("2026-12-11");
    expect(stepWindow("2026-12-11", 1, "2026-11-16", last)).toBeNull();
    // The week holding the last day on screen is not loaded yet: wait for it.
    expect(stepWindow("2026-11-22", 1, "2026-11-16", undefined)).toBeNull();
  });

  it("draws three days with the range in the header and arrows that move three days", () => {
    const html = render(review, "ko", true);

    expect(html).toContain('data-note-days="3"');
    expect(html.match(/data-note-heading="/g)).toHaveLength(3);
    expect(html).toContain('data-note-range="2026-11-16/2026-11-18"');
    expect(text(html)).toContain("11월 16일~18일");
    expect(html).toMatch(/<button[^>]*aria-label="이전 3일"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*aria-label="다음 3일"[^>]*disabled=""/);
    // The week does not scroll sideways.
    expect(html).not.toContain("min-w-[600px]");
    expect(html).not.toContain("overflow-x-auto");
    // Monday to Wednesday: Tuesday's 헬스 and Wednesday's 엄마 생일; Friday's 과제 마감 is not drawn.
    expect(block(html, "occ-헬스")).not.toBeNull();
    expect(block(html, "occ-엄마 생일")).not.toBeNull();
    expect(block(html, "occ-과제 마감")).toBeNull();
    expect(text(html)).toContain("팀 회의");
  });

  it("keeps the desktop week of seven days", () => {
    const html = render(review, "ko", false);
    expect(html).toContain('data-note-days="7"');
    expect(html).toContain('data-note-week="2026-11-16"');
    expect(html).toContain('aria-label="다음 주"');
    expect(html).toContain("min-w-[600px]");
  });

  it("records on 확인 only the candidates on days that were drawn, an unticked one as keep_busy", () => {
    const layout = layoutWeek(week, items);
    const monToWed = candidateKeys(layout.days.slice(0, 3));
    expect([...monToWed].sort()).toEqual(["key-엄마 생일", "key-헬스"]);

    const choices = new Map<string, "free" | "keep_busy">([
      ["key-엄마 생일", "free"],
      ["key-헬스", "keep_busy"],
      ["key-과제 마감", "free"],
    ]);
    expect(confirmedChoices(items, monToWed, choices)).toEqual([
      { decision: "free", key: "key-엄마 생일" },
      { decision: "keep_busy", key: "key-헬스" },
    ]);
    // Once Thursday to Saturday has been on screen too, Friday's entry counts.
    const both = new Set([...monToWed, ...candidateKeys(layout.days.slice(3, 6))]);
    expect(confirmedChoices(items, both, choices).map((choice) => choice.key)).toContain("key-과제 마감");
  });
});

describe("NoteEntryDetails", () => {
  const t = NOTE_REVIEW_COPY.en;

  it("shows the full title and the description as text, never as markup", () => {
    const long = "아주 긴 일정 제목이 겹친 칸에서는 잘려 보이지만 여기서는 전부 보여요";
    const html = renderToStaticMarkup(<NoteEntryDetails description={'첫 줄\n<img src=x onerror="alert(1)">'} t={t} title={long} />);

    expect(html).toMatch(new RegExp(`<h4[^>]*data-note-details-title[^>]*>${long}</h4>`));
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("whitespace-pre-line");
  });

  it("says briefly that there is no description", () => {
    const html = renderToStaticMarkup(<NoteEntryDetails description={null} t={t} title="헬스" />);
    expect(html).toContain('data-note-description="none"');
    expect(text(html)).toBe("헬스No description");
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

  it("asks a Telegram host to go back to Telegram in words, with no link to the bot", () => {
    const html = renderToStaticMarkup(
      <NoteReviewDone
        exit={{ channel: "telegram", href: "https://telegram.me/findmeatime_bot" }}
        locale="en"
        onBack={() => {}}
        review={{ ...review, decisions: [], items: [] }}
      />,
    );
    expect(text(html)).toContain("Please go back to Telegram.");
    expect(html).not.toContain("telegram.me");
    expect(html).not.toContain("Back to Telegram");
    expect(text(html)).toContain("Back");
  });
});
