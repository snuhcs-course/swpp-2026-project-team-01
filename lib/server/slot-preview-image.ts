import { readFile } from "node:fs/promises";
import { createElement, type CSSProperties, type ReactNode } from "react";
import type { LocalRange, SlotPreview } from "../contracts/slot-preview";
import { clockText, dayShort, durationText, MEETING_MODE_TEXTS, TRAVEL_MODE_TEXTS, weekText } from "./channel-texts";

// The slot image (host-onboarding-in-chat design 5): next week's open slots and
// their place as one PNG, rendered when the outbox sends it. It is drawn in the
// landing's language (DESIGN.md, apps/web/app/_components/ink/landing.css): a
// two-line Instrument Serif headline with the second line italic in ink blue, a
// soft board holding a white card with the week (days across, hours down, open
// time as panel-me blocks), and the meeting details as plain text under it.
//
// The image is English in every conversation; the caption sent with it carries
// the host's language. Only the place is shown as the host wrote it, so it falls
// back to the bundled Noto Sans KR subset for Hangul. Geist, Instrument Serif and
// that subset are bundled (THIRD_PARTY_NOTICES.md): next/og fetches glyphs that
// no given font has from Google Fonts at render time, so text outside them is
// dropped before rendering and a send never depends on that fetch. The files are
// read through `new URL(…, import.meta.url)`, which Next's file tracing follows
// into the job worker's function.

const INK = {
  canvas: "#F6F7F9",
  surface: "#FFFFFF",
  ink: "#1E2430",
  mutedInk: "#586172",
  primary: "#2C3E63",
  softSurface: "#E7EAF0",
  panelMe: "#DCE3F1",
} as const;

const WIDTH = 1080;
const HEIGHT = 1350;
const GRID_HEIGHT = 560;
const SANS = "Geist, Noto Sans KR";
const SERIF = "Instrument Serif";

// The code points the bundled fonts cover (Noto Sans KR's pyftsubset --unicodes list).
const OUTSIDE_FONT =
  /[^ -~ -ÿ‐-‧‰-›←-↓−　-〿ㄱ-ㆎ가-힣！-～]/gu;

function coveredText(text: string) {
  return text.replace(OUTSIDE_FONT, "").replace(/\s+/g, " ").trim();
}

type Font = { name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" | "italic" };

let fonts: Promise<Font[]> | null = null;

function loadFonts() {
  const file = (name: string) => readFile(new URL(`./fonts/${name}`, import.meta.url));
  fonts ??= Promise.all([
    file("Geist-Regular.ttf"),
    file("Geist-SemiBold.ttf"),
    file("InstrumentSerif-Regular.ttf"),
    file("InstrumentSerif-Italic.ttf"),
    file("NotoSansKR-Regular.woff"),
    file("NotoSansKR-Bold.woff"),
  ]).then(
    ([geist, geistSemiBold, serif, serifItalic, noto, notoBold]): Font[] => [
      { data: geist, name: "Geist", style: "normal", weight: 400 },
      { data: geistSemiBold, name: "Geist", style: "normal", weight: 600 },
      { data: serif, name: SERIF, style: "normal", weight: 400 },
      { data: serifItalic, name: SERIF, style: "italic", weight: 400 },
      { data: noto, name: "Noto Sans KR", style: "normal", weight: 400 },
      { data: notoBold, name: "Noto Sans KR", style: "normal", weight: 700 },
    ],
    (error: unknown) => {
      fonts = null;
      throw error;
    },
  );
  return fonts;
}

function box(style: CSSProperties, ...children: ReactNode[]) {
  return createElement("div", { style: { display: "flex", ...style } }, ...children);
}

function minutes(clock: string) {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

// A range in minutes from the day's start; an end at or before the start runs past midnight.
function span(range: LocalRange) {
  const start = minutes(range.start);
  const end = minutes(range.end);
  return { start, end: end > start ? end : end + 1440 };
}

function clockAt(minute: number) {
  const day = ((minute % 1440) + 1440) % 1440;
  return clockText(`${String(Math.floor(day / 60)).padStart(2, "0")}:${String(day % 60).padStart(2, "0")}`, "en");
}

function week(preview: SlotPreview) {
  const range = span(preview.grid);
  const firstHour = Math.floor(range.start / 60);
  const lastHour = Math.max(firstHour + 1, Math.ceil(range.end / 60));
  const hourHeight = GRID_HEIGHT / (lastHour - firstHour);
  const labelEvery = hourHeight >= 80 ? 1 : hourHeight >= 28 ? 2 : 3;
  const top = (minute: number) => ((minute - firstHour * 60) / 60) * hourHeight;
  const labels = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i).filter(
    (hour) => (hour - firstHour) % labelEvery === 0,
  );

  const hourColumn = box(
    { flexDirection: "column", paddingTop: 62, width: 78 },
    box(
      { height: GRID_HEIGHT, position: "relative" },
      ...labels.map((hour) =>
        box({ color: INK.mutedInk, fontFamily: SANS, fontSize: 19, position: "absolute", right: 14, top: top(hour * 60) - 12 }, clockAt(hour * 60)),
      ),
    ),
  );

  const days = preview.days.map((day) => {
    const blocks = day.open.flatMap((open) => {
      const slot = span(open);
      const start = Math.max(slot.start, firstHour * 60);
      const end = Math.min(slot.end, lastHour * 60);
      if (end <= start) return [];
      const height = top(end) - top(start);
      return [
        box(
          {
            backgroundColor: INK.panelMe,
            borderRadius: 8,
            flexDirection: "column",
            height: height - 4,
            left: 4,
            overflow: "hidden",
            padding: height > 44 ? "7px 9px" : 0,
            position: "absolute",
            right: 4,
            top: top(start) + 2,
          },
          ...(height > 44 ? [box({ color: INK.primary, fontFamily: SANS, fontSize: 19, fontWeight: 600 }, clockAt(slot.start))] : []),
          ...(height > 80 ? [box({ color: INK.primary, fontFamily: SANS, fontSize: 17 }, `to ${clockAt(slot.end)}`)] : []),
        ),
      ];
    });

    return box(
      { flex: 1, flexDirection: "column", minWidth: 0 },
      box(
        { alignItems: "center", height: 62, justifyContent: "center", paddingBottom: 12, alignSelf: "stretch" },
        box({ color: INK.mutedInk, fontFamily: SANS, fontSize: 21, fontWeight: 600 }, `${dayShort(day.weekday, "en")} ${Number(day.date.slice(8))}`),
      ),
      box({ backgroundColor: INK.canvas, borderRadius: 10, height: GRID_HEIGHT, position: "relative" }, ...blocks),
    );
  });

  return box({ width: "100%" }, hourColumn, box({ flex: 1, gap: 8 }, ...days));
}

function details(preview: SlotPreview) {
  const place = preview.meetingMode === "online" ? "" : coveredText(preview.place ?? "");
  const rows = [
    place ? ["Where", place] : null,
    ["How", MEETING_MODE_TEXTS.en[preview.meetingMode]],
    preview.travelMode ? ["Getting there", TRAVEL_MODE_TEXTS.en[preview.travelMode]] : null,
    ["Length", durationText(preview.durationMinutes, "en")],
  ].filter((row): row is string[] => row !== null);

  return box(
    { columnGap: 56, flexWrap: "wrap", marginTop: 30, rowGap: 18 },
    ...rows.map(([label, value]) =>
      box(
        { flexDirection: "column", gap: 4, width: 420 },
        box({ color: INK.mutedInk, fontFamily: SANS, fontSize: 20, fontWeight: 600 }, label),
        box({ color: INK.ink, fontFamily: SANS, fontSize: 26 }, value),
      ),
    ),
  );
}

export async function renderSlotPreviewPng(preview: SlotPreview): Promise<Buffer> {
  const headline = { fontFamily: SERIF, fontSize: 88, letterSpacing: -1.8, lineHeight: 0.98 } as const;
  const zone = coveredText(preview.timezone.split("/").pop()?.replace(/_/g, " ") ?? preview.timezone);
  const image = box(
    { backgroundColor: INK.canvas, flexDirection: "column", height: "100%", padding: "58px 64px 48px", width: "100%" },
    box(
      { alignItems: "center", justifyContent: "space-between" },
      box({ color: INK.ink, fontFamily: SERIF, fontSize: 34 }, "Find Me a Time"),
      box({ color: INK.primary, fontFamily: SANS, fontSize: 21, fontWeight: 600 }, weekText(preview.weekStart, "en")),
    ),
    box(
      { flexDirection: "column", marginTop: 40 },
      box({ ...headline, color: INK.ink }, "Your open times,"),
      box({ ...headline, color: INK.primary, fontStyle: "italic" }, "next week."),
    ),
    box(
      { backgroundColor: INK.softSurface, borderRadius: 24, marginTop: 36, padding: 22 },
      box({ backgroundColor: INK.surface, borderRadius: 16, flex: 1, flexDirection: "column", padding: "18px 20px 22px 4px" }, week(preview)),
    ),
    details(preview),
    box(
      { color: INK.mutedInk, fontFamily: SANS, fontSize: 20, justifyContent: "space-between", marginTop: "auto" },
      box({}, "Say yes and Thyme opens these for booking."),
      box({}, `Times in ${zone}`),
    ),
  );
  // Loaded on use: the agent service imports this module through the outbox but
  // cannot load next/og, and only the job worker renders.
  const { ImageResponse } = await import("next/og");
  const response = new ImageResponse(image, { fonts: await loadFonts(), height: HEIGHT, width: WIDTH });
  return Buffer.from(await response.arrayBuffer());
}
