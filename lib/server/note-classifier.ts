import { z } from "zod";
import type { AnalysisEvidence } from "../contracts/analysis";
import type { Weekday } from "../contracts/setup";

// The note classifier (calendar-note-review design 2). A model call apart from
// the host assistant, with no tools, recommends each note candidate as a note,
// a real event, or unsure. A recommendation frees no time: only the host's
// confirmation does (design 3). The model gets per candidate only a short ID for
// the call, the title as data, and the time shape; never the description,
// attendees or the location text. Whatever the model answers, the service keeps
// only one verdict per ID it sent, and every other outcome is "unsure".

export type NoteVerdict = "note" | "event" | "unsure";

export type NoteCandidate = AnalysisEvidence["noteLike"]["entries"][number];

// The model's short reason in both languages the product ships, so the review
// shows it in the host's screen language whenever the host opens it, whatever
// language the host wrote in when the scan ran (user, 2026-11-14).
export type NoteReasons = { readonly en: string; readonly ko: string };

export type NoteRecommendation = {
  readonly candidate: NoteCandidate;
  readonly verdict: NoteVerdict;
  // The model's short reason, shown to the host; null when there is no
  // recommendation (a failed call, or an ID the answer left out).
  readonly reasons: NoteReasons | null;
};

// What the model sees of one candidate.
export type NoteClassifierItem = {
  readonly id: string;
  readonly title: string;
  readonly allDay: boolean;
  readonly weekday: Weekday | null;
  // Local HH:mm start of a timed entry in the host timezone.
  readonly startTime: string | null;
  readonly durationMinutes: number | null;
  readonly durationDays: number | null;
  readonly repeats: boolean;
  readonly hasLocation: boolean;
  readonly hasConferenceLink: boolean;
};

// One model call for one batch. It resolves to the model's raw items, which
// classifyNoteCandidates validates, or throws when the call failed or was refused.
export type NoteClassifierModel = (
  items: readonly NoteClassifierItem[],
  options: {
    // Told the tokens the provider reports, so the usage limit can settle the
    // call's reservation (model-limits.ts).
    readonly onUsage?: (usage: NoteClassifierUsage) => void;
  },
) => Promise<unknown>;

export type NoteClassifierUsage = {
  readonly modelId: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
};

export const NOTE_CLASSIFIER_BATCH = 50;
export const NOTE_REASON_MAX = 120;
// Titles longer than this are cut before they reach the model.
const TITLE_MAX = 200;

const WEEKDAY_NAMES: Readonly<Record<string, Weekday>> = {
  Fri: "friday",
  Mon: "monday",
  Sat: "saturday",
  Sun: "sunday",
  Thu: "thursday",
  Tue: "tuesday",
  Wed: "wednesday",
};

const answerItemSchema = z.object({
  id: z.string(),
  reason_en: z.string(),
  reason_ko: z.string(),
  verdict: z.enum(["note", "event", "unsure"]),
});

// Both reasons cut to the limit; one language's reason stands in for a blank
// other, and two blank reasons are none.
function reasonsOf(en: string, ko: string): NoteReasons | null {
  const english = en.trim().slice(0, NOTE_REASON_MAX);
  const korean = ko.trim().slice(0, NOTE_REASON_MAX);
  if (!english && !korean) return null;
  return { en: english || korean, ko: korean || english };
}

function seriesKey(candidate: NoteCandidate) {
  return candidate.seriesId ? `${candidate.calendarId}\u0000series\u0000${candidate.seriesId}` : null;
}

function dayCount(start: string, end: string) {
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) && days > 0 ? days : 1;
}

// The time shape of a candidate in the host timezone, without any other text.
export function classifierItem(id: string, candidate: NoteCandidate, timezone: string): NoteClassifierItem {
  const base = {
    hasConferenceLink: candidate.hasConferenceLink ?? false,
    hasLocation: candidate.hasLocation ?? false,
    id,
    repeats: Boolean(candidate.seriesId),
    title: candidate.title.slice(0, TITLE_MAX),
  };

  if (candidate.allDay) {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(
      new Date(`${candidate.start}T00:00:00Z`),
    );
    return {
      ...base,
      allDay: true,
      durationDays: candidate.end ? dayCount(candidate.start, candidate.end) : 1,
      durationMinutes: null,
      startTime: null,
      weekday: WEEKDAY_NAMES[weekday] ?? null,
    };
  }

  const start = new Date(candidate.start);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", minute: "2-digit", timeZone: timezone, weekday: "short" })
      .formatToParts(start)
      .map((part) => [part.type, part.value]),
  );
  const end = candidate.end ? new Date(candidate.end) : null;
  const minutes = end ? Math.round((end.getTime() - start.getTime()) / 60_000) : NaN;

  return {
    ...base,
    allDay: false,
    durationDays: null,
    durationMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    startTime: Number.isNaN(start.getTime()) ? null : `${parts.hour}:${parts.minute}`,
    weekday: Number.isNaN(start.getTime()) ? null : (WEEKDAY_NAMES[parts.weekday!] ?? null),
  };
}

// Reads the model's raw items for the IDs of one batch: one verdict per known ID,
// with every missing, repeated, unknown or malformed answer left as no verdict.
function readAnswer(raw: unknown, ids: ReadonlySet<string>) {
  const verdicts = new Map<string, { verdict: NoteVerdict; reasons: NoteReasons | null }>();
  const repeated = new Set<string>();

  if (!Array.isArray(raw)) return verdicts;

  for (const entry of raw) {
    const parsed = answerItemSchema.safeParse(entry);
    if (!parsed.success || !ids.has(parsed.data.id)) continue;
    if (verdicts.has(parsed.data.id)) repeated.add(parsed.data.id);
    verdicts.set(parsed.data.id, { reasons: reasonsOf(parsed.data.reason_en, parsed.data.reason_ko), verdict: parsed.data.verdict });
  }

  for (const id of repeated) verdicts.delete(id);
  return verdicts;
}

// Recommends every candidate. Occurrences of one series are judged once, with
// the first occurrence standing for the series, and share its verdict. Batches
// are judged one after another; a batch whose call fails leaves its candidates
// unsure, and the other batches keep their verdicts.
export async function classifyNoteCandidates(
  candidates: readonly NoteCandidate[],
  model: NoteClassifierModel,
  options: { readonly timezone: string },
): Promise<NoteRecommendation[]> {
  // One representative per series, or the candidate itself.
  const groups = new Map<string, number>();
  const representatives: NoteCandidate[] = [];
  const groupOf = candidates.map((candidate) => {
    const key = seriesKey(candidate);
    const known = key === null ? undefined : groups.get(key);
    if (known !== undefined) return known;
    representatives.push(candidate);
    if (key !== null) groups.set(key, representatives.length - 1);
    return representatives.length - 1;
  });

  const judged: { verdict: NoteVerdict; reasons: NoteReasons | null }[] = representatives.map(() => ({ reasons: null, verdict: "unsure" }));

  for (let offset = 0; offset < representatives.length; offset += NOTE_CLASSIFIER_BATCH) {
    const batch = representatives.slice(offset, offset + NOTE_CLASSIFIER_BATCH);
    // IDs are fresh per call, so nothing the model saw names a calendar or event.
    const items = batch.map((candidate, index) => classifierItem(`c${index + 1}`, candidate, options.timezone));
    let raw: unknown;

    try {
      raw = await model(items, {});
    } catch {
      continue;
    }

    const verdicts = readAnswer(raw, new Set(items.map((item) => item.id)));
    items.forEach((item, index) => {
      const verdict = verdicts.get(item.id);
      if (verdict) judged[offset + index] = verdict;
    });
  }

  return candidates.map((candidate, index) => ({ candidate, ...judged[groupOf[index]!]! }));
}
