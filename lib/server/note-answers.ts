import type { Queryable } from "./database";
import type { NoteExclusion } from "./feasibility";

// How a host's note answer (calendar-note-review design 3) matches calendar
// events, shared by the scan, which leaves answered entries out of the
// candidates, and by feasibility, which skips excluded notes.
//
// An answer matches while the event was not edited after it: an occurrence answer
// that one event, a series answer every occurrence of the series on the same
// calendar, each while its updated time is not later than the fingerprint.
// Google gives occurrences of one series different updated times (an edited
// exception keeps its own), so equality would ask about the same series again
// every week; and our own writeback moves the fingerprint to Google's new updated
// time, which a scan from before the writeback must still count as answered.
// Editing the series, or one occurrence, after the answer gives a later updated
// time, so that entry is a candidate again.

export type NoteAnswerScope = "series" | "occurrence";

export type NoteAnswer = {
  readonly calendarId: string;
  // The series ID for scope "series", the occurrence's own ID otherwise.
  readonly eventId: string;
  readonly scope: NoteAnswerScope;
  readonly fingerprint: string;
};

type MatchedEvent = {
  readonly calendarId: string;
  readonly id: string;
  readonly recurringEventId: string | null;
  readonly updated: string | null;
};

function notLater(updated: string, fingerprint: string) {
  const at = Date.parse(updated);
  const answered = Date.parse(fingerprint);
  return Number.isNaN(at) || Number.isNaN(answered) ? updated === fingerprint : at <= answered;
}

function key(calendarId: string, eventId: string) {
  return `${calendarId}\u0000${eventId}`;
}

// A matcher over a set of answers, indexed by calendar and event.
export function noteAnswerMatcher(answers: readonly NoteAnswer[]) {
  const index = new Map<string, NoteAnswer[]>();
  for (const answer of answers) {
    const entry = index.get(key(answer.calendarId, answer.eventId));
    if (entry) entry.push(answer);
    else index.set(key(answer.calendarId, answer.eventId), [answer]);
  }

  return (event: MatchedEvent) => {
    if (index.size === 0) return false;
    const updated = event.updated ?? "";
    const own = index.get(key(event.calendarId, event.id)) ?? [];
    if (own.some((answer) => answer.scope === "occurrence" && notLater(updated, answer.fingerprint))) return true;
    if (!event.recurringEventId) return false;
    const series = index.get(key(event.calendarId, event.recurringEventId)) ?? [];
    return series.some((answer) => answer.scope === "series" && notLater(updated, answer.fingerprint));
  };
}

// Every answer the host gave, free or keep busy, whatever its writeback state: an
// answered entry is not judged or asked about again (a failed writeback is shown
// with its retry instead).
export async function readNoteAnswers(db: Queryable, hostAccountId: string): Promise<NoteAnswer[]> {
  const rows = await db<{ calendar_id: string; event_id: string; fingerprint: string; scope: NoteAnswerScope }[]>`
    select calendar_id, event_id, scope, fingerprint from app.calendar_note_decisions
    where host_account_id = ${hostAccountId}
  `;
  return rows.map((row) => ({ calendarId: row.calendar_id, eventId: row.event_id, fingerprint: row.fingerprint, scope: row.scope }));
}

// A note exclusion as an answer: entries saved before series exclusions existed
// name one occurrence.
export function exclusionAnswer(entry: NoteExclusion): NoteAnswer {
  return { calendarId: entry.calendarId, eventId: entry.eventId, fingerprint: entry.fingerprint, scope: entry.scope ?? "occurrence" };
}

export const MAX_NOTE_EXCLUSIONS = 200;

// Adds or replaces the exclusion of one decided item. Over the limit, entries
// whose events have ended go first, earliest end first; then the oldest entries,
// which become busy again (the safe direction) until the host answers anew.
export function withNoteExclusion(list: readonly NoteExclusion[], entry: NoteExclusion, now: Date): NoteExclusion[] {
  const next = [...withoutNoteExclusion(list, entry.calendarId, entry.eventId), entry];
  if (next.length <= MAX_NOTE_EXCLUSIONS) return next;

  const endOf = (item: NoteExclusion) => {
    if (!item.end) return Number.POSITIVE_INFINITY;
    const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(item.end) ? `${item.end}T00:00:00Z` : item.end);
    return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
  };
  const ended = next
    .map((item, position) => ({ end: endOf(item), position }))
    .filter((item) => item.end <= now.getTime() && next[item.position] !== entry)
    .sort((a, b) => a.end - b.end || a.position - b.position)
    .map((item) => item.position);
  const dropped = new Set(ended.slice(0, next.length - MAX_NOTE_EXCLUSIONS));
  for (let position = 0; next.length - dropped.size > MAX_NOTE_EXCLUSIONS; position += 1) dropped.add(position);
  return next.filter((_, position) => !dropped.has(position));
}

export function withoutNoteExclusion(list: readonly NoteExclusion[], calendarId: string, eventId: string): NoteExclusion[] {
  return list.filter((item) => item.calendarId !== calendarId || item.eventId !== eventId);
}
