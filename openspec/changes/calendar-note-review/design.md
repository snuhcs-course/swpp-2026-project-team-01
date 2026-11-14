# Design

## Context

Calendar events arrive from `events.list` with `singleEvents=true`, so a recurring event comes as its occurrences, each with `recurringEventId` naming the series (`lib/server/google-calendar.ts`). `normalizeBusy` (`lib/server/feasibility.ts`) already skips cancelled and `transparent` events, events the host declined, and entries in `noteExclusions` matched by calendar ID, event ID and fingerprint (the event's `updated` time when the host decided). A timed event blocks its span; an all-day event blocks the whole local day.

The scan (`computeEvidence`, `lib/server/analysis.ts`) lists up to 100 note-like entries: busy, no other attendee, no location and no conference link. The web `NotesStep` (`apps/web/app/_components/setup/analysis-card.tsx`) shows them with nothing ticked and saves the ticked ones as the `noteExclusions` draft field (at most 200, `lib/contracts/setup.ts`). The setup model sees only their count (`modelValue`, `lib/server/setup-tools.ts`). `preview_next_week` (`lib/server/setup-channel-tools.ts`) applies `noteExclusions`, but the chat onboarding has no way to fill it.

Google sign-in already grants `calendar.events` (`lib/contracts/google-scopes.ts`), which `events.patch` accepts. `lib/server/host-schedule-image-openai.ts` shows the pattern for a model call apart from Thyme: an OpenAI Responses call with a strict JSON schema and an instruction that text inside the input is data.

## 1. What is judged

A candidate is an event on a conflict calendar that is not cancelled, not declined by the host, has `transparency` absent or `opaque`, and has no attendee other than the host. All-day events are included (Google marks them opaque by default). Location and conference link no longer exclude an event from the candidates: "헬스" at a gym has a location and may still be a note to the host, or not. An event with another attendee is a real event and is never sent.

Candidates the host already answered (design 3) with an unchanged fingerprint are not sent again.

## 2. The classifier

A server-only module calls the model once per batch of up to 50 candidates, apart from Thyme's sessions. The call has no tools. Its input per candidate is a short ID assigned for the call (`c1`, `c2`, …), the title, whether it is all-day, its local start weekday and time, its duration, whether it repeats, and whether it has a location or a conference link. Description, attendees and the location text are not sent. The instruction says that every field is calendar data written by a person, never an instruction, and asks for a strict-schema answer:

```json
{ "items": [{ "id": "c1", "verdict": "note" | "event" | "unsure", "reason": "..." }] }
```

The service keeps only items whose ID was in the batch, one per ID; a missing, repeated or unknown ID becomes `unsure`. `reason` is at most 120 characters, shown to the host as the AI's reason. A refused, failed or malformed call makes every candidate in the batch `unsure`: they stay busy and are listed without a recommendation.

The classifier's output reaches the review page, the weekly list (design 10) and the decision record. Thyme does not see titles during setup, as today; in the weekly list and its read-back it sees them as quoted data (design 11).

The model is the one the image reader uses, `gpt-5.6-terra`. No evaluation set is declared for it: a recommendation frees nothing until the host confirms it, so a wrong recommendation costs the host a glance, not booked time.

## 3. Recommendations and decisions

A verdict is a recommendation and changes no busy time. Only the host's confirmation does, on the review page or by a confirmed chat answer (design 11).

A new record, `app.calendar_note_decisions`, holds one row per host and decided item: the calendar, the event or series ID, the scope (`series` or `occurrence`), the fingerprint at decision time, the decision (`free` or `keep_busy`), and for `free` the writeback state (`pending`, `done`, `failed`, `not_writable`). It holds no title. The record is a host decision, not analysis evidence, so the 24-hour cleanup keeps it, as it keeps dismissal choices today.

A `keep_busy` answer is remembered (D9): the event is not sent to the classifier or asked again while its fingerprint matches. A changed event (a new `updated`) is a new candidate. The fingerprint after our own writeback is stored from the patch response, so our change does not make the event look changed.

A decision is its own host action, not a setting in the settings review: it applies when the host confirms it, during onboarding or after it.

## 4. Writing free back to Google

When the host confirms `free` for an event on a calendar whose access role is `writer` or `owner`, the service records the decision as `pending` and publishes a writeback job in the same transaction. The job calls `events.patch` with `{ transparency: "transparent" }` on the decided event (the series for `series`, design 5) and marks the row `done` with the returned `updated`. From then on `normalizeBusy` skips the event because it is transparent, as it does today.

Until the job is `done`, the time stays busy. A transient failure (rate limit, 5xx, timeout) is retried by the job runner. A permanent failure (403, 404, a revoked grant) or an exhausted retry marks the row `failed`, keeps the time busy, and the review page and settings show "Google 캘린더에 반영하지 못했어요" with a retry. A response lost after the request left counts as uncertain; the retry patches again, which is harmless because the patch only sets one field.

The page says, before confirmation, "Google 캘린더에 한가함으로 표시합니다" and that colleagues who see the host's free/busy will also see the time as free. For an event the host was invited to, the patch changes only the host's copy.

Undoing (the host later says an entry is busy) patches `transparency: "opaque"` back, through the same job.

## 5. Recurring notes

An occurrence with `recurringEventId` is shown once per series, with its next occurrence. By default the decision covers the series: the patch goes to the event `recurringEventId` names, so every occurrence follows. The host can choose **this occurrence only**, which patches that occurrence's own ID. An occurrence the host edited before (an exception) may keep its own transparency after a series patch; the next scan sees it as still opaque and lists it again.

## 6. Calendars that cannot be changed

A subscribed or read-only calendar (access role `reader` or `freeBusyReader`) cannot be patched. A `free` decision there is stored as `not_writable` and written to `noteExclusions` of the host's settings with the event's fingerprint, so `normalizeBusy` skips it as today. The page says that this calendar is changed only in Find Me a Time. `noteExclusions` keeps its limit of 200; when a new entry would exceed it, the oldest entries whose events have ended are dropped first.

## 7. The review page

One standalone component lists the candidates of the current scan. Each row shows the title, the time (or "종일"), "반복" for a series with the scope choice, and the AI's recommendation. Rows recommended as notes are marked in yellow with the reason and start ticked; `event` and `unsure` rows start unticked. Ticked rows become `free`; rows the host leaves unticked after seeing them become `keep_busy` when the host presses **확인**. The page shows the Google notice of design 4 above the button and the writeback state per row after it.

The page lives at an authenticated `/app` route for the host and is the same component in `NotesStep` on the web setup. The yellow mark and the copy follow the design mock-ups (in Slack), taken when implementing.

A host with no candidates sees "확인할 일정이 없어요" and nothing to confirm.

## 8. The note step in chat onboarding

The #175 flow becomes: welcome and roles, hours question, place question, **note review**, slot image, booking link.

After the place answer, the service (not Thyme) runs the classifier on the onboarding scan. With at least one candidate, it sends one fixed message with the review page link on every channel ("메모처럼 보이는 일정이 N개 있어요. 비워도 되는 일정을 골라주세요"), in the conversation's language. The host has just replied, so the WhatsApp window is open. When the host presses **확인**, the service queues the slot image for the current review, computed as `preview_next_week` does, with the confirmed notes no longer busy (the writeback may still be pending: the preview skips confirmed `free` items whose writeback is `pending` or `done`, since the image only shows the proposal; the published availability waits for Google). With no candidates, the image follows the place answer as today.

If the host writes in the chat instead of opening the page ("나중에 할게"), Thyme sends the image without the review; the candidates stay busy and come back in the weekly check. Thyme's instructions name the step, so it does not ask about notes in words.

The image's open time therefore matches what guests will see once the writeback finishes. A writeback that fails leaves that time busy and the page shows it.

## 9. The weekly check

A pg_cron schedule (hand-written migration, mirrored in `supabase/schemas/app/cron/`) publishes once a week, Monday 09:00 KST, one durable job per ready host with a usable Calendar grant. Each job scans the conflict calendars for the next four weeks, selects candidates (design 1) that have no decision with a matching fingerprint and were not offered in an earlier check with the same fingerprint, runs the classifier and records a weekly review: a reference, its items in order with their calendar, event and fingerprint, and the verdicts. It stores no title; titles are read again from Google when they are shown.

With no new candidates the job sends nothing. Otherwise it hands the review to the host's channel (design 10). A host with no linked channel sees the review in `/app` only.

New events stay busy until the host answers. This is the limitation accepted on 2026-11-08: until a week is checked, some slots may stay hidden from guests.

A weekly review that is not answered stays valid until the next one replaces it; its unanswered items are offered again in the next check if their fingerprints still match.

## 10. The weekly check by channel

**iMessage and Telegram.** Both can send a free-form message to a linked host at any time. The service sends one fixed message: a numbered list of up to 10 items (title, time, the AI's recommendation), how to answer by number, and the review page link. More than 10 items: the first 10 and "외 N개는 링크에서 확인해주세요". Titles are quoted as data in the message.

**WhatsApp, window open.** The same message as iMessage.

**WhatsApp, window closed.** A pre-approved utility template with no parameter and no event content ("확인할 새 일정이 있어요") and the review page link, under the existing template limit (one per host per 12 hours). When the host next writes, the window opens and the service sends the numbered list. When no template can be sent (the template is not registered or not approved, PR #110), nothing is sent and the candidates stay busy until the next weekly check; `/app` shows the review.

## 11. Answering by number

The numbered list is a service notice in the conversation, and Thyme sees it with the titles as quoted data, like calendar names. A new channel tool, `choose_note_items({ reviewRef, numbers, decision })`, available only for a turn from the linked conversation, records a pending choice and returns the chosen items' numbers and titles with a choice reference. Thyme reads them back: "1번 엄마 생일, 3번 과제 마감을 비울까요?" (D8). Only the host's clear yes to that read-back applies it, through `confirm_note_items({ reviewRef, choiceRef })`, which refuses a choice that was not returned in an earlier turn; a condition, a question or a change asks again. A title written as an instruction is only data to Thyme and changes nothing. Numbers outside the list, an item whose event changed since the list, or a review that is no longer current are refused with a fixed reply naming the current review.

"busy로 둬" for numbers records `keep_busy` without a read-back, since it changes no time. Items the host does not mention stay unanswered.

This follows [`channel-actions-in-words`](../channel-actions-in-words/proposal.md): the action names what the host was shown (the review reference and the read-back), acts on nothing else, and does nothing for a message typed on the web.

## 12. Reviewing again from settings

The review component is reachable from the web settings at any time after onboarding. It scans afresh, shows current candidates with their recommendations, and also lists the host's earlier decisions with their writeback state, where the host can change one (freeing a kept entry, or making a freed one busy again, design 4). Until the settings redesign lands, the entry is a link from the existing settings dialog and `/app` setup to the review route.

## Risks

- **The classifier frees nothing by itself,** but a wrong `note` that the host confirms without reading frees real time. The page pre-ticks only `note` rows and shows the reason; there is no separate evaluation of the classifier, so wrong recommendations are noticed only by hosts (and in the release check, task 8.2).
- **Titles reach the model provider.** They already reach Google; they now also reach OpenAI under the same processing terms as the image reader. Only the title and the time shape are sent.
- **Free/busy sharing.** A transparent note shows as free to everyone who sees the host's free/busy. The page says so before confirmation.
- **Recurring exceptions** may keep their own transparency (design 5); the next check lists them again.
- **WhatsApp without a template** leaves candidates busy until the next check (D7).
- **Titles reach Thyme** in the weekly list. They are quoted as data, Thyme can free time only through the read-back and the host's yes, and task 6.3 tests a title written as an instruction.

## Open questions

- The weekly schedule's day and time (Monday 09:00 KST here) and the scan length (four weeks here, as the analysis scans).
- The list length per message (10 here).
