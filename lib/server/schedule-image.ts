import type { ScheduleImage, ScheduleImageDay, ScheduleImageEntry, ScheduleImageKind } from "../contracts/schedule-image";
import { dayShort } from "./channel-texts";
import { box, clockAt, coveredText, INK, pngOf, SANS, SERIF } from "./slot-preview-image";

// The schedule image (messenger-schedule-image design 3): the host's days as one
// PNG, drawn next to the slot image and in its language (DESIGN.md): the same
// header, two-line Instrument Serif headline and soft board, with days across
// and hours down. Each entry is coloured by where it comes from, as on the
// Dashboard: a booked meeting in ink blue, another Google Calendar event in
// grey, a request to decide dashed amber (not booked) and a sent request
// outlined. All-day entries sit in a strip above the hours. The image is
// English in every conversation, like the slot image; titles fall back to the
// bundled Noto Sans KR subset, and what no bundled font covers is dropped.

const GRID_HEIGHT = 620;
const ALL_DAY_SHOWN = 2;

const AMBER = { fill: "#FDF3E1", line: "#B7791F", text: "#7A4B00" } as const;

const STYLES: Record<ScheduleImageKind, { readonly fill: string; readonly text: string; readonly border: string }> = {
  approved_meeting: { border: `2px dashed ${INK.primary}`, fill: INK.surface, text: INK.primary },
  booked_meeting: { border: `2px solid ${INK.primary}`, fill: INK.primary, text: INK.surface },
  calendar_event: { border: `2px solid ${INK.softSurface}`, fill: INK.softSurface, text: INK.ink },
  request_to_decide: { border: `2px dashed ${AMBER.line}`, fill: AMBER.fill, text: AMBER.text },
  sent_request: { border: `2px solid ${INK.primary}`, fill: INK.surface, text: INK.primary },
};

const LEGEND: readonly [ScheduleImageKind, string][] = [
  ["booked_meeting", "Booked"],
  ["approved_meeting", "Approved · Adding to Google Calendar"],
  ["calendar_event", "Calendar"],
  ["request_to_decide", "To decide"],
  ["sent_request", "You asked"],
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Nov 24", "Nov 24–30" or "Nov 30–Dec 6".
export function periodText(from: string, through: string) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${through}T00:00:00Z`);
  const first = `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`;
  if (from === through) return first;
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  return `${first}–${sameMonth ? "" : `${MONTHS[end.getUTCMonth()]} `}${end.getUTCDate()}`;
}

function minutes(clock: string) {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

// Side-by-side lanes for overlapping entries (in start order): each takes the
// first lane free at its start, and a group of entries that overlap one another
// in a chain shares its width among the lanes that group needs.
export function lanesOf(entries: readonly ScheduleImageEntry[]) {
  const placed: { lane: number; of: number }[] = [];
  let group: number[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const index of group) placed[index]!.of = Math.max(1, ends.length);
    group = [];
    ends = [];
  };
  entries.forEach((entry, index) => {
    const start = minutes(entry.start);
    const end = entry.end === "24:00" ? 1440 : minutes(entry.end);
    if (start >= groupEnd) close();
    const free = ends.findIndex((laneEnd) => laneEnd <= start);
    const lane = free === -1 ? ends.length : free;
    ends[lane] = end;
    groupEnd = Math.max(start >= groupEnd ? end : groupEnd, end);
    placed[index] = { lane, of: 1 };
    group.push(index);
  });
  close();
  return placed;
}

function chip(kind: ScheduleImageKind, text: string) {
  const style = STYLES[kind];
  return box(
    {
      backgroundColor: style.fill,
      border: style.border,
      borderRadius: 6,
      color: style.text,
      fontFamily: SANS,
      fontSize: 14,
      height: 26,
      overflow: "hidden",
      padding: "2px 6px",
    },
    text,
  );
}

// A day's all-day entries between its name and its hours, at the strip's shared height.
function allDayStrip(day: ScheduleImageDay, height: number) {
  const shown = day.allDay.slice(0, ALL_DAY_SHOWN);
  const more = day.allDay.length - shown.length;
  return box(
    { flexDirection: "column", gap: 4, height, overflow: "hidden" },
    ...shown.map((entry) => chip(entry.kind, coveredText(entry.title) || "Event")),
    ...(more > 0 ? [box({ color: INK.mutedInk, fontFamily: SANS, fontSize: 14 }, `+${more} more`)] : []),
  );
}

function grid(image: ScheduleImage) {
  const mostAllDay = Math.max(0, ...image.days.map((day) => day.allDay.length));
  const stripHeight = mostAllDay === 0 ? 0 : Math.min(ALL_DAY_SHOWN, mostAllDay) * 30 + (mostAllDay > ALL_DAY_SHOWN ? 20 : 0) + 10;
  // The strip takes its height from the hours, so the footer always fits.
  const gridHeight = GRID_HEIGHT - stripHeight;
  const firstHour = Math.floor(minutes(image.grid.start) / 60);
  const lastHour = Math.max(firstHour + 1, Math.ceil(minutes(image.grid.end) / 60));
  const hourHeight = gridHeight / (lastHour - firstHour);
  const labelEvery = hourHeight >= 56 ? 1 : hourHeight >= 28 ? 2 : 3;
  const top = (minute: number) => ((minute - firstHour * 60) / 60) * hourHeight;
  const labels = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i).filter((hour) => (hour - firstHour) % labelEvery === 0);

  const hourColumn = box(
    { flexDirection: "column", paddingTop: 62 + stripHeight, width: 78 },
    box(
      { height: gridHeight, position: "relative" },
      ...labels.map((hour) =>
        box({ color: INK.mutedInk, fontFamily: SANS, fontSize: 19, position: "absolute", right: 14, top: top(hour * 60) - 12 }, clockAt(hour * 60)),
      ),
    ),
  );

  const columns = image.days.map((day) => {
    const lanes = lanesOf(day.entries);
    const blocks = day.entries.flatMap((entry, index) => {
      const start = Math.max(minutes(entry.start), firstHour * 60);
      const end = Math.min(entry.end === "24:00" ? 1440 : minutes(entry.end), lastHour * 60);
      if (end <= start) return [];
      const height = Math.max(top(end) - top(start) - 3, 14);
      const style = STYLES[entry.kind];
      const { lane, of } = lanes[index]!;
      const width = 100 / of;
      // The start time only when there is room for it above the title.
      const timed = height > 52 && of === 1;
      return [
        box(
          {
            backgroundColor: style.fill,
            border: style.border,
            borderRadius: 7,
            flexDirection: "column",
            height,
            left: `${lane * width}%`,
            overflow: "hidden",
            padding: height > 30 ? "4px 6px" : "0 6px",
            position: "absolute",
            top: top(start) + 1,
            width: `${width}%`,
          },
          ...(timed ? [box({ color: style.text, fontFamily: SANS, fontSize: 15, fontWeight: 600 }, clockAt(minutes(entry.start)))] : []),
          box({ color: style.text, fontFamily: SANS, fontSize: 15, lineHeight: 1.2 }, coveredText(entry.title) || "Event"),
        ),
      ];
    });
    return box(
      { flex: 1, flexDirection: "column", minWidth: 0 },
      box(
        { alignItems: "center", alignSelf: "stretch", height: 62, justifyContent: "center", paddingBottom: 12 },
        box({ color: INK.mutedInk, fontFamily: SANS, fontSize: 21, fontWeight: 600 }, `${dayShort(day.weekday, "en")} ${Number(day.date.slice(8))}`),
      ),
      ...(stripHeight > 0 ? [allDayStrip(day, stripHeight)] : []),
      box({ backgroundColor: INK.canvas, borderRadius: 10, height: gridHeight, position: "relative" }, ...blocks),
    );
  });

  return box({ width: "100%" }, hourColumn, box({ flex: 1, gap: 8 }, ...columns));
}

function legend() {
  return box(
    { columnGap: 28, flexWrap: "wrap", marginTop: 26, rowGap: 12 },
    ...LEGEND.map(([kind, label]) =>
      box(
        { alignItems: "center", gap: 10 },
        box({ backgroundColor: STYLES[kind].fill, border: STYLES[kind].border, borderRadius: 5, height: 22, width: 34 }),
        box({ color: INK.ink, fontFamily: SANS, fontSize: 22 }, label),
      ),
    ),
  );
}

export async function renderScheduleImagePng(image: ScheduleImage): Promise<Buffer> {
  const headline = { fontFamily: SERIF, fontSize: 88, letterSpacing: -1.8, lineHeight: 0.98 } as const;
  const zone = coveredText(image.timezone.split("/").pop()?.replace(/_/g, " ") ?? image.timezone);
  const empty = image.days.every((day) => day.entries.length === 0 && day.allDay.length === 0);
  const note =
    image.googleCalendar === "unavailable"
      ? "Google Calendar could not be read; only Find Me a Time meetings and requests are shown."
      : empty
        ? "Nothing is on your calendar for these days."
        : "Requests to decide are not booked until you approve them.";
  const page = box(
    { backgroundColor: INK.canvas, flexDirection: "column", height: "100%", padding: "58px 64px 48px", width: "100%" },
    box(
      { alignItems: "center", justifyContent: "space-between" },
      box({ color: INK.ink, fontFamily: SERIF, fontSize: 34 }, "Find Me a Time"),
      box({ color: INK.primary, fontFamily: SANS, fontSize: 21, fontWeight: 600 }, periodText(image.from, image.through)),
    ),
    box(
      { flexDirection: "column", marginTop: 40 },
      box({ ...headline, color: INK.ink }, "Your schedule,"),
      box({ ...headline, color: INK.primary, fontStyle: "italic" }, `${periodText(image.from, image.through)}.`),
    ),
    box(
      { backgroundColor: INK.softSurface, borderRadius: 24, marginTop: 36, padding: 22 },
      box({ backgroundColor: INK.surface, borderRadius: 16, flex: 1, flexDirection: "column", padding: "18px 20px 22px 4px" }, grid(image)),
    ),
    legend(),
    box(
      { color: INK.mutedInk, fontFamily: SANS, fontSize: 20, gap: 24, justifyContent: "space-between", marginTop: "auto" },
      box({ flex: 1 }, note),
      box({}, `Times in ${zone}`),
    ),
  );
  return pngOf(page);
}
