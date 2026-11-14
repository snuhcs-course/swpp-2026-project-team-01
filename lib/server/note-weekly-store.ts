import type { NoteCandidate, NoteVerdict } from "./note-classifier";
import type { Queryable, Transaction } from "./database";
import { publishJob } from "./jobs";
import { notLater } from "./note-answers";
import { requestRef } from "./request-ref";

// The weekly note check's settings and stored review (calendar-note-review
// design 9 to 11). This module holds only what the Calendar analysis job needs
// as well, so the analysis does not depend on the weekly check's handlers.

// The open questions of design 9 and 10, answered with the design's assumed
// defaults and kept here so each changes in one place. The day and time are
// pg_cron's: schedule 'app-weekly-note-check', '0 0 * * 1' in UTC (Monday 09:00
// in Asia/Seoul), in supabase/schemas/app/cron/weekly_note_check.sql and its
// migration; the week a check belongs to is the Monday in SCHEDULE_TIME_ZONE.
export const WEEKLY_NOTE_CHECK = {
  scheduleTimeZone: "Asia/Seoul",
  // How far the check's scan reads, back and ahead; candidates are the entries
  // ahead that have not ended.
  scanDays: 28,
  // Entries listed by number in one message; the rest are named by count.
  listLimit: 10,
} as const;

// pg_cron publishes one per ready host and week; it starts the week's scan.
export const WEEKLY_NOTE_CHECK_JOB = "weekly_note_check";
// The finished scan publishes it; it records the review and sends the list.
export const WEEKLY_NOTE_REVIEW_JOB = "weekly_note_review";
// A WhatsApp host who writes after the template gets the list (design 10).
export const WEEKLY_NOTE_LIST_JOB = "weekly_note_list";

// The outbox dedupe key of a review's numbered list. Its own prefix, apart from
// the onboarding step's "onboarding-notes:" (group 4), so the onboarding's
// waiting check never sees it.
export const WEEKLY_LIST_PREFIX = "weekly-notes:";
export const WEEKLY_NOTE_TEMPLATE = "fmat_note_review";

export function weeklyListKey(reviewId: string, reopened = false) {
  return `${WEEKLY_LIST_PREFIX}${reviewId}${reopened ? ":reopened" : ""}`;
}

// The list's reference, named to the model so an answer names the list it answers.
export function weeklyReviewRef(reviewId: string) {
  return requestRef(reviewId);
}

export type WeeklyNoteItem = {
  readonly calendarId: string;
  // The occurrence shown; its series when it repeats.
  readonly eventId: string;
  readonly seriesId: string | null;
  // What an answer records: the shown entry's updated time, or the latest of the
  // series' listed occurrences.
  readonly fingerprint: string;
  readonly start: string;
  readonly end: string | null;
  readonly allDay: boolean;
  readonly verdict: NoteVerdict | null;
};

export type PendingNoteChoice = {
  readonly ref: string;
  readonly numbers: readonly number[];
  // The host message the read-back answered; the yes must come in a later one.
  readonly inputId: string | null;
};

export type WeeklyNoteReview = {
  readonly id: string;
  readonly hostAccountId: string;
  readonly week: string;
  readonly analysisId: string | null;
  readonly timezone: string;
  readonly items: readonly WeeklyNoteItem[];
  readonly pendingChoice: PendingNoteChoice | null;
  readonly createdAt: Date;
};

type ReviewRow = {
  id: string;
  host_account_id: string;
  week: string;
  analysis_id: string | null;
  timezone: string;
  items: WeeklyNoteItem[];
  pending_choice: PendingNoteChoice | null;
  created_at: Date;
};

function reviewOf(row: ReviewRow): WeeklyNoteReview {
  return {
    analysisId: row.analysis_id,
    createdAt: row.created_at,
    hostAccountId: row.host_account_id,
    id: row.id,
    items: row.items,
    pendingChoice: row.pending_choice,
    timezone: row.timezone,
    week: row.week,
  };
}

// The host's current weekly review, or null. With lock, the row is locked for
// the caller's transaction.
export async function readWeeklyReview(q: Queryable, hostAccountId: string, options: { readonly lock?: boolean } = {}) {
  const [row] = await q<ReviewRow[]>`
    select id, host_account_id, to_char(week, 'YYYY-MM-DD') as week, analysis_id, timezone, items, pending_choice, created_at
    from app.calendar_note_weekly_reviews where host_account_id = ${hostAccountId}
    ${options.lock ? q`for update` : q``}
  `;
  return row ? reviewOf(row) : null;
}

export async function readWeeklyReviewById(q: Queryable, reviewId: string) {
  const [row] = await q<ReviewRow[]>`
    select id, host_account_id, to_char(week, 'YYYY-MM-DD') as week, analysis_id, timezone, items, pending_choice, created_at
    from app.calendar_note_weekly_reviews where id = ${reviewId}
  `;
  return row ? reviewOf(row) : null;
}

// The verdicts the host's current list gave, for the next scan: an entry of the
// same calendar and event or series that was not edited since keeps its verdict
// instead of going to the classifier again.
export async function knownWeeklyVerdicts(q: Queryable, hostAccountId: string) {
  const review = await readWeeklyReview(q, hostAccountId);
  const known = new Map<string, WeeklyNoteItem>();
  for (const item of review?.items ?? []) {
    if (item.verdict) known.set(`${item.calendarId}\u0000${item.seriesId ?? item.eventId}`, item);
  }
  return (entry: NoteCandidate): NoteVerdict | null => {
    const item = known.get(`${entry.calendarId}\u0000${entry.seriesId ?? entry.eventId}`);
    return item?.verdict && notLater(entry.fingerprint, item.fingerprint) ? item.verdict : null;
  };
}

// From a WhatsApp host's message, in the receipt's transaction (design 10): when
// the current list was held back by the closed window and its template notice
// went out, the list follows now that the window is open, once. A template that
// could not be sent (refused, or over the template limits) means nothing more is
// sent; the review waits on /app/notes until the next check.
export async function reopenWeeklyNoteList(tx: Transaction, hostAccountId: string, bindingId: string) {
  const review = await readWeeklyReview(tx, hostAccountId);
  if (!review) return false;
  const key = weeklyListKey(review.id);
  const [held] = await tx<{ id: string }[]>`
    select list.id from app.imessage_outbox list
    join app.imessage_outbox template on template.kind = 'template' and template.dedupe_key = 'template:' || list.dedupe_key
    where list.kind = 'notice' and list.dedupe_key = ${key} and list.binding_id = ${bindingId}
      and list.state in ('suppressed', 'failed') and list.failure_category = 'window_closed'
      and template.state not in ('failed', 'suppressed')
  `;
  if (!held) return false;
  return (
    (await publishJob(tx, {
      dedupeKey: `${WEEKLY_NOTE_LIST_JOB}:${review.id}`,
      kind: WEEKLY_NOTE_LIST_JOB,
      payload: { bindingId, reviewId: review.id },
    })) !== null
  );
}

// From the finished scan of a weekly check, in its transaction.
export async function publishWeeklyNoteReview(tx: Transaction, input: { readonly analysisId: string; readonly hostAccountId: string; readonly week: string }) {
  await publishJob(tx, {
    dedupeKey: `${WEEKLY_NOTE_REVIEW_JOB}:${input.analysisId}`,
    kind: WEEKLY_NOTE_REVIEW_JOB,
    payload: input,
  });
}

// What read_setup_state shows of the weekly list: its reference and size only.
// Titles reach the model through choose_note_items, as quoted data.
export async function weeklyNoteListForModel(db: Queryable, hostAccountId: string) {
  const review = await readWeeklyReview(db, hostAccountId);
  return review
    ? { entries: review.items.length, listedAt: review.createdAt.toISOString(), reviewRef: weeklyReviewRef(review.id) }
    : null;
}
