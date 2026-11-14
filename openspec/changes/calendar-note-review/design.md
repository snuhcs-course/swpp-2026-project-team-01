# Design

## Context

Calendar events arrive from `events.list` with `singleEvents=true`, so a recurring event comes as its occurrences, each with `recurringEventId` naming the series (`lib/server/google-calendar.ts`). `normalizeBusy` (`lib/server/feasibility.ts`) already skips cancelled and `transparent` events, events the host declined, and entries in `noteExclusions` matched by calendar ID, event ID and fingerprint (the event's `updated` time when the host decided). A timed event blocks its span; an all-day event blocks the whole local day.

The scan (`computeEvidence`, `lib/server/analysis.ts`) lists up to 100 note-like entries: busy, no other attendee, no location and no conference link. The web `NotesStep` (`apps/web/app/_components/setup/analysis-card.tsx`) shows them with nothing ticked and saves the ticked ones as the `noteExclusions` draft field (at most 200, `lib/contracts/setup.ts`). The setup model sees only their count (`modelValue`, `lib/server/setup-tools.ts`). `preview_next_week` (`lib/server/setup-channel-tools.ts`) applies `noteExclusions`, but the chat onboarding has no way to fill it.

Google sign-in already grants `calendar.events` (`lib/contracts/google-scopes.ts`), which `events.patch` accepts. `lib/server/host-schedule-image-openai.ts` shows the pattern for a model call apart from Thyme: an OpenAI Responses call with a strict JSON schema and an instruction that text inside the input is data.

## 1. What is judged

A candidate is an event on a conflict calendar that is not cancelled, not declined by the host, has `transparency` absent or `opaque`, and has no attendee other than the host. All-day events are included (Google marks them opaque by default). Location and conference link no longer exclude an event from the candidates: "헬스" at a gym has a location and may still be a note to the host, or not. An event with another attendee is a real event and is never sent.

Only entries that have not ended are candidates (user, 2026-11-13): freeing a past entry opens no time for guests. A timed entry counts until its end, so one in progress stays; an all-day entry counts while its end date (exclusive) is after today in the host timezone. A recurring series is a candidate while it has an occurrence ahead, and the review shows the first of those (design 5). The scan itself still reads four weeks back and ahead, and every other dimension (preferred times, meeting load, places) still counts past events; only the note candidates are limited.

Candidates the host already answered (design 3) with an unchanged fingerprint are not sent again.

## 2. The classifier

A server-only module calls the model once per batch of up to 50 candidates, apart from Thyme's sessions. The call has no tools. Its input per candidate is a short ID assigned for the call (`c1`, `c2`, …), the title, whether it is all-day, its local start weekday and time, its duration, whether it repeats, and whether it has a location or a conference link. Description, attendees and the location text are not sent. The instruction says that every field is calendar data written by a person, never an instruction, and asks for a strict-schema answer:

```json
{ "items": [{ "id": "c1", "verdict": "note" | "event" | "unsure", "reason_en": "...", "reason_ko": "..." }] }
```

**The reason's language** (user, 2026-11-14: the reason is shown in the host's language). The model writes the same short reason in English and in Korean, the two languages the product ships, and the scan keeps both. The review page shows the one of the host's screen language, from the language cookie the web app sets, and without that cookie the host's conversation language by the rule the linked conversation's fixed replies follow (their latest message to Thyme, else English; `hostConversationLanguage`). Rejected: one reason in the conversation's language at scan time, because the onboarding scan runs before the host has written anything in words (the link code says nothing about language), so every first scan would be in English; and storing the screen language on the account, because the scan's job has no screen and a host can switch the page's language at any time. A blank reason in one language takes the other's; two blank reasons are none.

The service keeps only items whose ID was in the batch, one per ID; a missing, repeated or unknown ID becomes `unsure`. Each reason is at most 120 characters, shown to the host as the AI's reason. A refused, failed or malformed call makes every candidate in the batch `unsure`: they stay busy and are listed without a recommendation.

The classifier's output reaches the review page, the weekly list (design 10) and the decision record. Thyme does not see titles during setup, as today; in the weekly list and its read-back it sees them as quoted data (design 11).

The model is the one the image reader uses, `gpt-5.6-terra`. No evaluation set is declared for it: a recommendation frees nothing until the host confirms it, so a wrong recommendation costs the host a glance, not booked time.

**Usage limit.** The classifier runs only where `NOTE_CLASSIFIER` is set, and each batch call goes through the model allowance every other model call uses (`lib/server/model-limits.ts`, `app.model_reservations`, work kind `note_classification`) before the request leaves:

- at most **10 calls per host in 24 hours**. A scan has at most 100 candidates, so two calls; ten allow five scans a day (the first scan, a calendar change and a few **Analyze again**), and later the weekly check;
- each call reserves **USD 0.10**, above its upper bound (a 50-entry batch of short JSON and at most 6,000 output tokens for the two reasons, about USD 0.08 at the published prices), and is settled to the usage OpenAI reports; an answer without usage stays at USD 0.10;
- the reservation counts toward the host's USD 30 and the service's USD 300 windows of 24 hours, like the image reader and the conversation.

A denied call sends nothing and leaves its batch `unsure`: the candidates are listed without a recommendation and stay busy, the same as a failed call. Rejected: no limit (Analyze again could call the model without end); a limit per scan only (a host could rescan without end); reusing the image reader's five-attempt count (one scan of 100 candidates would spend two of them).

**The weekly check shares this allowance.** Its scan (design 9) calls the classifier through the same `note_classification` work kind and the same 10 calls per host in 24 hours; it gets no work kind of its own. It sends only the candidates that are new or changed since the previous list (an unanswered entry keeps the verdict that list gave), so a typical week is one call and at most two, once a week. A host who spent the day's ten calls on **Analyze again** before Monday 09:00 gets the list without recommendations (every entry `unsure`), which frees nothing and is checked by the host as any list is. Rejected: a separate work kind for the weekly check (it would raise the host's daily ceiling to twenty calls for a job that needs two a week, and the allowance exists to bound spend per host, not per caller).

## 3. Recommendations and decisions

A verdict is a recommendation and changes no busy time. Only the host's confirmation does, on the review page or by a confirmed chat answer (design 11).

A new record, `app.calendar_note_decisions`, holds one row per host and decided item: the calendar, the event or series ID, the scope (`series` or `occurrence`), the fingerprint at decision time, the decision (`free` or `keep_busy`), and for `free` the writeback state (`pending`, `done`, `failed`, `not_writable`). It holds no title. The record is a host decision, not analysis evidence, so the 24-hour cleanup keeps it, as it keeps dismissal choices today.

A `keep_busy` answer is remembered (D9): the event is not sent to the classifier or asked again while its fingerprint matches. A changed event (a new `updated`) is a new candidate. The fingerprint after our own writeback is stored from the patch response, so our change does not make the event look changed.

A series answer is matched differently, because Google gives the occurrences of one series their own `updated` times (an edited exception keeps its own). It stores the latest `updated` of the occurrences the host saw, and an occurrence of that series on the same calendar matches while its `updated` is not later than that. Editing the series or one occurrence after the answer gives a later time, so that entry is a candidate again. An occurrence answer follows the same rule, so a scan read before our own writeback (whose fingerprint is Google's new `updated`) still counts the entry as answered. The same rule applies to a series note exclusion (design 6).

A decision is its own host action, not a setting in the settings review: it applies when the host confirms it, during onboarding or after it.

## 4. Writing free back to Google

When the host confirms `free` for an event on a calendar whose access role is `writer` or `owner`, the service records the decision as `pending` and publishes a writeback job in the same transaction. The job calls `events.patch` with `{ transparency: "transparent" }` on the decided event (the series for `series`, design 5) and marks the row `done` with the returned `updated`. From then on `normalizeBusy` skips the event because it is transparent, as it does today.

Until the job is `done`, the time stays busy. A transient failure (rate limit, 5xx, timeout) is retried by the job runner; Google's rate limits that arrive as 403 (`rateLimitExceeded`, `userRateLimitExceeded`) count as transient. A permanent failure (any other 403, 400, 404, 410, a revoked grant) or an exhausted retry marks the row `failed`, keeps the time busy, and the review page and settings show "Google 캘린더에 반영하지 못했어요" with a retry. A response lost after the request left counts as uncertain; the retry patches again, which is harmless because the patch only sets one field.

The page gives no Google notice before **확인** (user, 2026-11-13); after it, the freed entries are listed under "Google 캘린더에 기록합니다" (design 7). For an event the host was invited to, the patch changes only the host's copy.

Undoing (the host later says an entry is busy) patches `transparency: "opaque"` back, through the same job.

## 5. Recurring notes

An occurrence with `recurringEventId` is shown once per series, with its next occurrence. By default the decision covers the series: the patch goes to the event `recurringEventId` names, so every occurrence follows. The service also accepts a decision for **one occurrence**, which patches that occurrence's own ID; the review page does not offer it (user, 2026-11-13: one checkbox per series keeps the week simple). An occurrence the host edited before (an exception) may keep its own transparency after a series patch; the next scan sees it as still opaque and lists it again. Known gap: when that exception's `updated` is not later than the series answer's fingerprint (design 3), the scan counts it as answered and does not list it, so it stays busy (the safe direction) until it is edited again. The Google stand-in does not model exceptions, so no test covers this.

## 6. Calendars that cannot be changed

A subscribed or read-only calendar (access role `reader` or `freeBusyReader`) cannot be patched. A `free` decision there is stored as `not_writable` and written to `noteExclusions` of the host's settings with the event's fingerprint, so `normalizeBusy` skips it as today. The page shows no words about this (user, 2026-11-13): the entry is listed among the freed ones like any other. `noteExclusions` keeps its limit of 200; when a new entry would exceed it, the oldest entries whose events have ended are dropped first, and then the oldest entries, which become busy again (the safe direction). A series exclusion names the series and carries `scope: "series"`. Before the host has confirmed settings, the decision row stands alone and Confirm and save adds its exclusion to the settings it writes; afterwards each decision changes the confirmed settings' `noteExclusions` directly, and Confirm and save keeps them.

## 7. The review page

One standalone component draws the candidates as a week, like Google Calendar (user, 2026-11-13: the host judges a note beside the rest of the week): Monday to Sunday on a vertical hour axis, all-day entries in a row under the day headings, in the look of the slot image that follows it in the chat onboarding (serif title, a white card on a soft board, day headings, the hour axis on the left, rounded blocks, DESIGN.md's ink palette). The page opens on the week of today and moves a week back or ahead within the scan's four weeks ahead.

- **Candidates** are yellow blocks with a checkbox each, one per listed occurrence (a series shows on each of its occurrences); checked means free. Those the classifier recommends as notes start checked, the others unchecked, and the classifier's reason is the block's tooltip. Checking an entry that repeats checks the whole series (user, 2026-11-13: the page offers no "this occurrence only"; the server still accepts that scope). Nothing else sits between the week and the button: no panel, legend, count or notice.
- **The host's other busy entries** of the week are grey blocks for context; they cannot be chosen. They are read from Google when the page shows the week and are stored nowhere, so the scan's 24-hour evidence holds no more than the candidates; titles reach only the signed-in host, attendees never leave the server, and no title goes to a model. A cancelled entry, one the host declined, and one already transparent (free) are not drawn. If Google cannot be read, only the candidates are drawn, with a notice.
- **확인** records the candidates of the weeks the host has looked at: those checked become `free`, the others `keep_busy`. Candidates of weeks the host has not opened stay unanswered and busy, so nothing is freed unseen. An answer the host left as it was records nothing new.
- **After 확인** the page says the note entries are checked ("메모 용도의 일정을 체크했습니다") and lists only the freed entries, each with its day and time, under one quiet line that they are written to Google Calendar ("Google 캘린더에 기록합니다"). A failed writeback is the only state given words, with a retry, since that entry is still busy. **뒤로** returns to the week with the host's answers checked as they stand, so one can be changed: unchecking a freed entry patches it back to opaque (design 4). The main button takes the host back to the chat they set up in, opened in its app ("iMessage로 돌아가기" through the `sms:` link, "WhatsApp으로 돌아가기" through `wa.me`, Telegram through `t.me`); without a linked chat, or on a computer with no Messages app, it reads "완료" and opens `/app` (user, 2026-11-13).

The page lives at an authenticated `/app` route for the host and is the same component in `NotesStep` on the web setup. The yellow mark and the copy follow the design mock-ups (in Slack), taken when implementing. On a narrow screen the week scrolls sideways; showing three days at a time on a phone is a follow-up outside this iteration (task 3.2).

A host with no candidates sees the empty week and nothing to confirm.

## 8. The note step in chat onboarding

The #175 flow becomes: welcome and roles, hours question, place question, **note review**, slot image, booking link.

The classifier has already run inside the onboarding scan (design 2), which settles before the hours question. After the place answer, Thyme calls `preview_next_week` as before; the service, not Thyme, decides what it sends:

- **Candidates.** When the latest scan is complete, the host has not confirmed settings yet, and at least one candidate is unanswered, the tool sends one fixed message with the review page link (`/app/notes`) on every channel instead of the image ("메모처럼 보이는 일정이 N개 있어요. 비워도 되는 일정을 골라주세요. 고르시면 가능한 시간을 보내드릴게요: …"), in the conversation's language, with N counting a series once. The host has just replied, so the WhatsApp window is open. The link's outbox row (dedupe key `onboarding-notes:{binding}`) is the step's record: one per linked chat, and the chat waits for the image while no slot image was recorded for that binding since the link. No table is added for it. The tool tells Thyme the link went out (`noteReviewSent`), and a second call while the chat waits is refused with the same words.
- **확인 wakes the chat.** Pressing **확인** on the review (`notes.confirm_review`) publishes, in the same transaction as the decisions, one durable job `onboarding_slot_image` when the host's linked chat waits. It does so even when no answer changed, so the page always sends that 확인 while the chat waits. A replayed or repeated 확인 publishes the same job once (its dedupe key names the link's row). The job reads next week from Google, computes the image as `preview_next_week` does with the confirmed notes no longer busy, and records it for the current settings review. A draft that changed meanwhile or Google being unavailable retries the job; a revoked grant or an unlinked chat sends nothing. The preview skips confirmed `free` items whose writeback is `pending` or `done` and those kept in Find Me a Time only (`not_writable`), since the image only shows the proposal; the published availability waits for Google. The host then answers the image as today.
- **No candidates** (none found, all answered, a scan that failed or is still running, or settings already confirmed): the image follows the place answer at once, with no link, as today.
- **Skip.** If the host writes in the chat instead of opening the page ("나중에 할게"), Thyme calls `preview_next_week` with `skipNoteReview`, and the image is sent with the candidates still busy; they come back in the weekly check. A later 확인 on the page still records its answers but sends no second image, because the chat no longer waits.
- **No answer for a day** (user, 2026-11-14). Recording the link also publishes one delayed `onboarding_slot_image` job (dedupe key `onboarding_slot_image:{link}:wait`, payload `waited`). If, when it runs, the chat still waits by `noteStepOf` (no 확인 and no skip sent the image), it sends the image with the unanswered candidates still busy, under the same image dedupe key as 확인 (`slot-preview:{binding}:notes:{link}`), so one image goes out whichever comes first; otherwise it sends nothing. The candidates come back in the weekly check (design 9). A later 확인 records its answers and sends no second image, as after a skip.
  - **The wait** is 24 hours on iMessage and Telegram. On WhatsApp it is 23 hours: the window opened with the host's place answer right before the link and closes 24 hours later, so the image leaves an hour before then. If the window is closed anyway (the job ran late), the send job holds the image back as for any free-form text, with no template, and the chat no longer waits: when the host next writes, Thyme's `preview_next_week` sends the image as after a skip.
  - **One line with it.** The image comes with one short notice that the note-like entries were kept busy and can still be chosen later, with the review link ("메모처럼 보이는 일정은 일단 바쁨으로 두었어요. 비워도 되는 일정은 나중에 여기서 고를 수 있어요: …", outbox key `onboarding-notes-later:{link}`, sent a few seconds after the image). Without it the image would arrive a day later with no word on the link the host did not answer, and its open time would look smaller than the host expects. The line asks nothing, so a "yes" still answers the image's caption.
  - Outbox rows are kept 30 days, so a link opened after that only records answers. A host who changes a setting while the chat waits gets the image for the settings as they stand at 확인 or at the end of the wait.

Thyme's instructions name the step, so it does not ask about notes in words. On the review's done view, a host whose chat waits for the image sees one quiet line under the freed entries, "가능한 시간을 메시지로 보내드릴게요" ("I'll send your open times by message."), shown after a 확인 that queued the image.

The image's open time therefore matches what guests will see once the writeback finishes. A writeback that fails leaves that time busy and the page shows it.

## 9. The weekly check

A pg_cron schedule (`app-weekly-note-check`, `0 0 * * 1` in UTC, which is Monday 09:00 KST; hand-written migration `20261114090100_weekly_note_check_schedule`, mirrored in `supabase/schemas/app/cron/weekly_note_check.sql`) runs `app.publish_weekly_note_checks()`, which publishes one durable `weekly_note_check` job per active host with confirmed settings and a stored, valid Google grant, keyed by the host and the week's Monday in Asia/Seoul, so a second run in the same week publishes nothing. The job checks readiness exactly (`readReadiness`) and publishes a fresh Calendar analysis of the conflict calendars, four weeks back and ahead, under the key `weekly-{week}`; the review page shows that scan too. The scan's candidates are those of design 1 that have no decision with a matching fingerprint (design 3), so an answered entry is left out and an entry left unanswered in the last list comes back while unchanged: an entry the host does not answer is asked about again every week until they answer it (user, 2026-11-14), as the spec's "Only new entries asked" scenario says. Only new or changed candidates go to the classifier (D10): an unanswered entry keeps the verdict the previous list gave while its fingerprint matches.

The finished scan publishes `weekly_note_review`, which records the weekly review in `app.calendar_note_weekly_reviews`: one row per host with the week, the scan, the host timezone and the items in time order with their calendar, the event shown, its series, the fingerprint an answer records and the verdict. It stores no title; titles come from the scan while its evidence is kept (24 hours) and are read again from Google after that. The new row replaces the host's previous one, so the old list's reference and any choice awaiting a yes stop being current. A replayed check or review for the same week records nothing new.

With no candidate left the job records and sends nothing, and the previous review stays. Otherwise it queues the list to the host's channel (design 10). A host with no linked channel sees the review in `/app/notes` only.

New events stay busy until the host answers. This is the limitation accepted on 2026-11-08: until a week is checked, some slots may stay hidden from guests.

The defaults of the open questions (Monday 09:00 KST, a four-week scan, ten entries per message) are kept in one place, `WEEKLY_NOTE_CHECK` in `lib/server/note-weekly-store.ts`, except the day and time, which is the cron expression in the schedule's migration and its mirror.

## 10. The weekly check by channel

**iMessage and Telegram.** Both can send a free-form message to a linked host at any time. The service sends one fixed message (`channelReplies(…).notes.weeklyList`, outbox dedupe key `weekly-notes:{review}`, a prefix apart from the onboarding step's `onboarding-notes:`): a numbered list of up to 10 items (title, time in the host timezone, the AI's recommendation), how to answer by number, and the review page link. More than 10 items: the first 10 and "외 N개는 링크에서 확인해주세요". Each title is one line in quotes, with its own quotes replaced and cut at 60 characters, so it reads as data. Telegram gets it as plain text.

**WhatsApp, window open.** The same message as iMessage.

**WhatsApp, window closed.** The send job holds the list back as for any free-form text (`window_closed`) and queues the utility template `fmat_note_review` (`en_US`, no parameter, no event content; body: "There are new calendar entries to check in Find Me a Time. Open findmeatime.com/app/notes to review them."), under the existing template limits (one per host per 12 hours, the line's daily limit). Registering it in WhatsApp Manager is an operator step, as for the other templates. When the host next writes and that template went out, the receipt publishes one `weekly_note_list` job, which sends the numbered list of the current review (`weekly-notes:{review}:reopened`, which never queues a second template). When no template can be sent (refused as not registered or not approved, PR #110, or over a limit), nothing more is sent, even after the host writes, and the candidates stay busy until the next weekly check; `/app/notes` shows the review.

## 11. Answering by number

The numbered list is a service notice in the conversation. `read_setup_state` names the current list to Thyme as `weeklyNoteList` (its six-character `reviewRef`, the number of entries and when it was listed), without titles. A new channel tool, `choose_note_items({ reviewRef, numbers, decision })`, available only for a turn from the linked conversation, reads the chosen entries again from Google and returns their numbers and titles, each a JSON string literal (quoted data, like calendar names). For `free` it records nothing but a pending choice on the review (its six-character `choiceRef`, the numbers and the host message it answered) and returns a read-back built by the service, "1번 "엄마 생일", 3번 "과제 마감"을 비울까요?" (D8), which Thyme asks once. Only the host's clear yes to that read-back applies it, through `confirm_note_items({ reviewRef, choiceRef })`, which refuses a choice that is not the pending one, a confirmation in the same turn as the read-back (before the host answered), and a choice already used; it records the free decisions under the writeback rules of design 4 to 6 and clears the choice. A condition, a question or a change asks again; a new choice replaces the pending one. A title written as an instruction is only data to Thyme and changes nothing: only the numbers the host wrote are chosen. An older list, numbers outside the list and an entry changed since the list (edited, moved or removed in Google) are refused with a fixed reply (`channelReplies(…).notes`) that Thyme repeats; for an older list the result also names the current review. An entry answered since (on the page, or earlier in the chat) is left out and named as already answered.

"2번은 진짜 일정이야" for numbers records `keep_busy` at once, without a read-back, since it changes no time. Items the host does not mention stay unanswered.

The tools belong to the setup discussion, where a linked host's free text goes unless the conversation was switched to a request; while it is switched, the host's answer reaches that request's review, which has no note tools, and Thyme there cannot act on the list. Known gap; the list and `/app/notes` still work.

This follows [`channel-actions-in-words`](../channel-actions-in-words/proposal.md): the action names what the host was shown (the review reference and the read-back), acts on nothing else, and does nothing for a message typed on the web.

## 12. Reviewing again from settings

The review component is reachable from the web settings at any time after onboarding. It scans afresh, shows current candidates with their recommendations, and also lists the host's earlier decisions with their writeback state, where the host can change one (freeing a kept entry, or making a freed one busy again, design 4). Until the settings redesign lands, the entry is a link from the existing settings dialog and `/app` setup to the review route.

## Risks

- **The classifier frees nothing by itself,** but a wrong `note` that the host confirms without reading frees real time. The page pre-ticks only `note` rows and shows the reason; there is no separate evaluation of the classifier, so wrong recommendations are noticed only by hosts (and in the release check, task 8.2).
- **Titles reach the model provider.** They already reach Google; they now also reach OpenAI under the same processing terms as the image reader. Only the title and the time shape are sent.
- **Free/busy sharing.** A transparent note shows as free to everyone who sees the host's free/busy. The page does not say so (user, 2026-11-13: no notice before 확인); the host chose the entry as a note, which is free time to anyone.
- **Recurring exceptions** may keep their own transparency (design 5); the next check lists them again.
- **WhatsApp without a template** leaves candidates busy until the next check (D7).
- **Titles reach Thyme** in the weekly list. They are quoted as data, Thyme can free time only through the read-back and the host's yes, and task 6.3 tests a title written as an instruction.

## Open questions

- The weekly schedule's day and time (Monday 09:00 KST here) and the scan length (four weeks here, as the analysis scans). Implemented with these defaults (design 9).
- The list length per message (10 here). Implemented with this default (design 9).
