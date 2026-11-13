import type { NoteReviewItem, NoteWeek } from "@lib/contracts/note-review";

// Where each entry of the note review's week goes, in the host timezone: all-day
// entries in the row under the day headings, timed ones on the hour grid, side
// by side when they overlap (Google Calendar's columns). Candidates come from the
// review's items, the grey context from the week's other busy entries.

export type WeekBlock = {
  readonly id: string;
  readonly kind: "candidate" | "busy";
  readonly title: string;
  readonly start: string;
  readonly end: string | null;
  readonly allDay: boolean;
  // The candidate this block stands for, and which of its occurrences.
  readonly itemKey?: string;
  readonly occurrenceId?: string;
  // Minutes from the day's local midnight, for timed blocks.
  readonly startMinute: number;
  readonly endMinute: number;
  readonly lane: number;
  readonly lanes: number;
};

export type WeekDay = {
  readonly date: string;
  readonly allDay: WeekBlock[];
  readonly timed: WeekBlock[];
};

export type WeekLayout = {
  readonly days: WeekDay[];
  readonly firstHour: number;
  readonly lastHour: number;
  // The candidates with an occurrence in this week.
  readonly itemKeys: ReadonlySet<string>;
};

const MINUTES_IN_DAY = 24 * 60;

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function localParts(timeZone: string) {
  const format = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  });
  return (iso: string) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
  };
}

type Placed = Omit<WeekBlock, "lane" | "lanes">;

// Columns for overlapping blocks: each cluster of blocks that overlap one
// another shares its width between as many lanes as it needs.
function withLanes(blocks: Placed[]): WeekBlock[] {
  const sorted = [...blocks].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
  const result: WeekBlock[] = [];
  let cluster: { block: Placed; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const close = () => {
    for (const { block, lane } of cluster) result.push({ ...block, lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const block of sorted) {
    if (block.startMinute >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= block.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.endMinute);
    } else {
      laneEnds[lane] = block.endMinute;
    }
    cluster.push({ block, lane });
    clusterEnd = Math.max(clusterEnd, block.endMinute);
  }
  close();
  return result;
}

export function layoutWeek(week: NoteWeek, items: readonly NoteReviewItem[]): WeekLayout {
  const dates = Array.from({ length: 7 }, (_, index) => addDays(week.start, index));
  const inWeek = new Set(dates);
  const local = localParts(week.timezone);
  const allDay = new Map(dates.map((date) => [date, [] as WeekBlock[]]));
  const timed = new Map(dates.map((date) => [date, [] as Placed[]]));
  const itemKeys = new Set<string>();

  const place = (block: Omit<Placed, "startMinute" | "endMinute">) => {
    if (block.allDay) {
      // An all-day entry covers its dates up to the (exclusive) end date.
      const last = block.end && block.end > block.start ? block.end : addDays(block.start, 1);
      let placed = false;
      for (let date = block.start; date < last; date = addDays(date, 1)) {
        if (!inWeek.has(date)) continue;
        allDay.get(date)!.push({ ...block, endMinute: MINUTES_IN_DAY, lane: 0, lanes: 1, startMinute: 0 });
        placed = true;
      }
      return placed;
    }
    const start = local(block.start);
    if (!inWeek.has(start.date)) return false;
    const end = block.end ? local(block.end) : { date: start.date, minute: start.minute + 30 };
    // An entry past midnight is drawn to the end of its first day.
    const endMinute = end.date > start.date ? MINUTES_IN_DAY : Math.max(end.minute, start.minute + 15);
    timed.get(start.date)!.push({ ...block, endMinute, startMinute: start.minute });
    return true;
  };

  for (const item of items) {
    for (const occurrence of item.occurrences) {
      const placed = place({
        allDay: occurrence.allDay,
        end: occurrence.end,
        id: `${item.key}\u0000${occurrence.id}`,
        itemKey: item.key,
        kind: "candidate",
        occurrenceId: occurrence.id,
        start: occurrence.start,
        title: item.title,
      });
      if (placed) itemKeys.add(item.key);
    }
  }
  for (const event of week.events) {
    place({ allDay: event.allDay, end: event.end, id: `busy\u0000${event.id}`, kind: "busy", start: event.start, title: event.title });
  }

  const days = dates.map((date) => ({ allDay: allDay.get(date)!, date, timed: withLanes(timed.get(date)!) }));
  const timedBlocks = days.flatMap((day) => day.timed);
  const firstHour = Math.min(8, ...timedBlocks.map((block) => Math.floor(block.startMinute / 60)));
  const lastHour = Math.max(22, ...timedBlocks.map((block) => Math.ceil(block.endMinute / 60)));
  return { days, firstHour, itemKeys, lastHour: Math.min(24, lastHour) };
}
