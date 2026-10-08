// AI provenance: OpenAI Codex; initially generated 2026-10-05 (Asia/Seoul); scope: file.
import { ownerAvailability, seoulDay, SEOUL_OFFSET, type TimeWindow } from "./availability";

export const MEETING_DURATIONS = [30, 45, 60, 90, 120, 180, 240];
export type LinkOptions = { duration: number; from: string; to: string; startTime: string; endTime: string; weekdays: number[] };
export const dateKey = (value: Date | string | number) => new Date(new Date(value).getTime() + SEOUL_OFFSET).toISOString().slice(0, 10);
export function defaultLinkOptions(now = Date.now()): LinkOptions {
  return { duration: 60, from: dateKey(seoulDay(1, 0, 0, now)), to: dateKey(seoulDay(14, 0, 0, now)), startTime: "09:00", endTime: "20:00", weekdays: [1, 2, 3, 4, 5] };
}
export function validateLinkOptions(input: unknown, now = Date.now()): LinkOptions {
  if (!input || typeof input !== "object") throw new Error("공개 범위를 확인해 주세요.");
  const value = input as LinkOptions;
  const defaults = defaultLinkOptions(now);
  if (!MEETING_DURATIONS.includes(value.duration)) throw new Error("미팅 길이를 선택해 주세요.");
  if (![value.from, value.to].every((date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00+09:00`)) && dateKey(`${date}T00:00:00+09:00`) === date)) throw new Error("날짜를 확인해 주세요.");
  if (value.from < defaults.from || value.to > defaults.to || value.from > value.to) throw new Error("공개 날짜는 내일부터 14일 이내로 선택해 주세요.");
  if (![value.startTime, value.endTime].every((time) => typeof time === "string" && /^(?:[01]\d|2[0-3]):(?:00|30)$/.test(time)) || value.startTime < "09:00" || value.endTime > "20:00" || value.startTime >= value.endTime) throw new Error("공개 시간은 09:00–20:00 안에서 30분 간격으로 선택해 주세요.");
  if (!Array.isArray(value.weekdays) || !value.weekdays.length || value.weekdays.some((day) => ![1, 2, 3, 4, 5].includes(day))) throw new Error("공개할 평일을 하나 이상 선택해 주세요.");
  return { duration: value.duration, from: value.from, to: value.to, startTime: value.startTime, endTime: value.endTime, weekdays: [...new Set(value.weekdays)].sort() };
}

export function hostCandidates(events: Array<{ start: Date; end: Date; busy?: boolean }>, options: LinkOptions, now = Date.now()) {
  const candidates: TimeWindow[] = [];
  for (const window of ownerAvailability(events, now)) {
    const day = dateKey(window.start);
    const weekday = new Date(Date.parse(window.start) + SEOUL_OFFSET).getUTCDay();
    if (day < options.from || day > options.to || !options.weekdays.includes(weekday)) continue;
    const from = Math.max(Date.parse(window.start), Date.parse(`${day}T${options.startTime}:00+09:00`));
    const to = Math.min(Date.parse(window.end), Date.parse(`${day}T${options.endTime}:00+09:00`));
    for (let start = from; start + options.duration * 60_000 <= to; start += 30 * 60_000) candidates.push({ start: new Date(start).toISOString(), end: new Date(start + options.duration * 60_000).toISOString() });
  }
  // Distribute the first choices across days; fill remaining choices with non-overlapping times.
  const ordered = candidates.sort((a, b) => {
    const hourA = new Date(Date.parse(a.start) + SEOUL_OFFSET).getUTCHours();
    const hourB = new Date(Date.parse(b.start) + SEOUL_OFFSET).getUTCHours();
    return Math.abs(hourA - 11) - Math.abs(hourB - 11) || Date.parse(a.start) - Date.parse(b.start);
  });
  const selected: TimeWindow[] = [];
  for (const uniqueDays of [true, false]) {
    for (const candidate of ordered) {
      if (uniqueDays && selected.some((slot) => dateKey(slot.start) === dateKey(candidate.start))) continue;
      if (selected.some((slot) => Date.parse(slot.start) < Date.parse(candidate.end) && Date.parse(slot.end) > Date.parse(candidate.start))) continue;
      selected.push(candidate);
      if (selected.length === 5) return selected.sort((a, b) => a.start.localeCompare(b.start));
    }
  }
  return selected.sort((a, b) => a.start.localeCompare(b.start));
}
