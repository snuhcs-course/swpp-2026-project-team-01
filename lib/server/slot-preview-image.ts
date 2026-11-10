import { readFile } from "node:fs/promises";
import { createElement, type CSSProperties, type ReactNode } from "react";
import type { LocalRange, SlotPreview } from "../contracts/slot-preview";
import type { ChannelLanguage } from "./channel-language";
import { clockText, dayShort, durationText, MEETING_MODE_TEXTS, TRAVEL_MODE_TEXTS, weekText } from "./channel-texts";

// The slot image (host-onboarding-in-chat design 5): next week's open slots and
// their place as one PNG, rendered when the outbox sends it. A phone-width week
// grid, days across and hours down, open time shaded in ink blue, under a header
// with the place, the meeting mode, the travel mode and the duration, in DESIGN.md's
// ink palette.
//
// The fonts are a bundled Noto Sans KR subset (Latin, Hangul and common
// punctuation; THIRD_PARTY_NOTICES.md). next/og fetches glyphs that no given font
// has from Google Fonts at render time, so text outside the subset is dropped
// before rendering and a send never depends on that fetch. The files are read
// through `new URL(…, import.meta.url)`, which Next's file tracing follows into
// the job worker's function.

const INK = {
  canvas: "#F6F7F9",
  surface: "#FFFFFF",
  ink: "#1E2430",
  mutedInk: "#586172",
  primary: "#2C3E63",
  onPrimary: "#FFFFFF",
  softSurface: "#E7EAF0",
} as const;

const WIDTH = 1080;
const HEIGHT = 1350;
const GRID_HEIGHT = 850;
const FONT = "Noto Sans KR";

const TEXTS = {
  en: { title: "Next week's open times", online: "Online meetings", timezone: (zone: string) => `Times in ${zone}` },
  ko: { title: "다음 주 비어 있는 시간", online: "온라인 미팅", timezone: (zone: string) => `${zone} 기준` },
} as const;

// The code points the bundled subset covers (the pyftsubset --unicodes list).
const OUTSIDE_FONT =
  /[^ -~ -ÿ‐-‧‰-›←-↓−　-〿ㄱ-ㆎ가-힣！-～]/gu;

function coveredText(text: string) {
  return text.replace(OUTSIDE_FONT, "").replace(/\s+/g, " ").trim();
}

type Font = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

let fonts: Promise<Font[]> | null = null;

function loadFonts() {
  fonts ??= Promise.all([
    readFile(new URL("./fonts/NotoSansKR-Regular.woff", import.meta.url)),
    readFile(new URL("./fonts/NotoSansKR-Bold.woff", import.meta.url)),
  ]).then(
    ([regular, bold]): Font[] => [
      { data: regular, name: FONT, style: "normal", weight: 400 },
      { data: bold, name: FONT, style: "normal", weight: 700 },
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

function hourLabel(hour: number, language: ChannelLanguage) {
  return clockText(`${String(hour % 24).padStart(2, "0")}:00`, language);
}

function header(preview: SlotPreview, language: ChannelLanguage) {
  const texts = TEXTS[language];
  const place = preview.meetingMode === "online" ? null : coveredText(preview.place ?? "");
  // Online only is the heading itself, so its chips are the duration alone.
  const chips = [
    place === null ? null : MEETING_MODE_TEXTS[language][preview.meetingMode],
    preview.travelMode ? TRAVEL_MODE_TEXTS[language][preview.travelMode] : null,
    durationText(preview.durationMinutes, language),
  ].filter((chip): chip is string => chip !== null);

  return box(
    { flexDirection: "column", gap: 14 },
    box({ color: INK.mutedInk, fontSize: 28 }, `${texts.title} · ${weekText(preview.weekStart, language)}`),
    box({ color: INK.ink, fontSize: 52, fontWeight: 700, lineHeight: 1.2 }, place || texts.online),
    box(
      { gap: 12, marginTop: 6 },
      ...chips.map((chip) =>
        box({ backgroundColor: INK.softSurface, borderRadius: 9999, color: INK.ink, fontSize: 26, padding: "8px 22px" }, chip),
      ),
    ),
  );
}

function grid(preview: SlotPreview, language: ChannelLanguage) {
  const range = span(preview.grid);
  const firstHour = Math.floor(range.start / 60);
  const lastHour = Math.ceil(range.end / 60);
  const hourHeight = GRID_HEIGHT / Math.max(1, lastHour - firstHour);
  const labelEvery = hourHeight >= 40 ? 1 : 2;
  const top = (minute: number) => ((minute - firstHour * 60) / 60) * hourHeight;
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);

  const hourLines = hours.map((hour) =>
    box({ backgroundColor: INK.softSurface, height: 2, left: 0, position: "absolute", right: 0, top: top(hour * 60) - 1 }),
  );

  const timeColumn = box(
    { height: GRID_HEIGHT, position: "relative", width: 76 },
    ...hours
      .filter((hour) => (hour - firstHour) % labelEvery === 0)
      .map((hour) =>
        box(
          { color: INK.mutedInk, fontSize: 21, position: "absolute", right: 12, top: Math.min(top(hour * 60) - 14, GRID_HEIGHT - 28) },
          hourLabel(hour, language),
        ),
      ),
  );

  const columns = preview.days.map((day) => {
    const blocks = day.open.flatMap((open) => {
      const slot = span(open);
      const start = Math.max(slot.start, firstHour * 60);
      const end = Math.min(slot.end, lastHour * 60);
      if (end <= start) return [];
      const height = top(end) - top(start);
      return [
        box(
          {
            backgroundColor: INK.primary,
            borderRadius: 10,
            color: INK.onPrimary,
            flexDirection: "column",
            fontSize: 20,
            fontWeight: 700,
            height: height - 4,
            left: 4,
            lineHeight: 1.2,
            overflow: "hidden",
            padding: height >= 34 ? "6px 8px" : 0,
            position: "absolute",
            right: 4,
            top: top(start) + 2,
          },
          ...(height >= 34 ? [open.start] : []),
          ...(height >= 62 ? [`–${open.end}`] : []),
        ),
      ];
    });
    const [, month, date] = day.date.split("-").map(Number);
    const weekend = day.weekday === "saturday" || day.weekday === "sunday";

    return box(
      { flex: 1, flexDirection: "column", gap: 10, minWidth: 0 },
      box(
        { alignItems: "baseline", flexDirection: "column", height: 66, justifyContent: "flex-end" },
        box({ color: weekend ? INK.mutedInk : INK.ink, fontSize: 28, fontWeight: 700 }, dayShort(day.weekday, language)),
        box({ color: INK.mutedInk, fontSize: 21 }, `${month}/${date}`),
      ),
      box(
        { backgroundColor: INK.canvas, borderRadius: 12, height: GRID_HEIGHT, overflow: "hidden", position: "relative" },
        ...hourLines,
        ...blocks,
      ),
    );
  });

  return box(
    { backgroundColor: INK.surface, borderRadius: 24, padding: "20px 24px 28px 8px" },
    box({ flexDirection: "column", paddingTop: 76 }, timeColumn),
    box({ flex: 1, gap: 6 }, ...columns),
  );
}

export async function renderSlotPreviewPng(preview: SlotPreview, language: ChannelLanguage): Promise<Buffer> {
  const image = box(
    {
      backgroundColor: INK.canvas,
      flexDirection: "column",
      fontFamily: FONT,
      gap: 28,
      height: "100%",
      padding: "52px 56px 40px",
      width: "100%",
    },
    header(preview, language),
    grid(preview, language),
    box(
      { color: INK.mutedInk, fontSize: 22, justifyContent: "space-between", marginTop: "auto" },
      box({}, "Find Me a Time"),
      box({}, TEXTS[language].timezone(coveredText(preview.timezone))),
    ),
  );
  // Loaded on use: the agent service imports this module through the outbox but
  // cannot load next/og, and only the job worker renders.
  const { ImageResponse } = await import("next/og");
  const response = new ImageResponse(image, { fonts: await loadFonts(), height: HEIGHT, width: WIDTH });
  return Buffer.from(await response.arrayBuffer());
}
