# Tasks

## 1. Classifier

- [ ] 1.1 Select note candidates (opaque, no other attendee, all-day included) in `lib/server/analysis.ts`, skipping entries answered with a matching fingerprint. Verify unit tests for an event with a guest, a transparent event, an all-day event and an answered entry.
- [ ] 1.2 Add the classifier module beside `lib/server/host-schedule-image-openai.ts`: no tools, strict schema `{id, verdict, reason}`, batches of 50, titles as data, unknown or missing IDs as `unsure`. Verify unit tests for a malformed answer, an unknown ID, a failed call, and a title written as an instruction (OWASP LLM01) that frees nothing. No evaluation set is declared: the host confirms every recommendation.

## 2. Writing free back to Google

- [ ] 2.1 Add `app.calendar_note_decisions` (decision, scope, fingerprint, writeback state; no title) in `supabase/schemas/` with its generated migration, kept by analysis cleanup. Verify database tests for RLS and cleanup.
- [ ] 2.2 Add `events.patch` for transparency to `lib/server/google-calendar.ts` and a writeback job kind: retry transient failures, mark permanent failures `failed`, store the returned `updated`. Verify integration tests through the Google stand-in for success, a 403, a timeout then success, and a replay.
- [ ] 2.3 Patch the series by default and one occurrence on request; undo by patching `opaque`. Verify integration tests for both scopes and an undo.
- [ ] 2.4 Record free decisions on calendars the host cannot write as `noteExclusions` (`lib/contracts/setup.ts`, `normalizeBusy`), with the 200-entry limit. Verify unit tests for a subscribed calendar and the limit.

## 3. The review page

- [ ] 3.1 Build the review as a standalone week view like Google Calendar (design 7: a checkbox on each yellow candidate, pre-checked for `note`, the reason as its tooltip, grey context from the week's other busy entries read live, all-day row, week navigation; after 확인, the freed entries with their times under the Google line and a way back to change them) and use it in `NotesStep` and an authenticated `/app` route. Apply the design mock-ups from Slack. Verify component tests and a Playwright test from scan to confirmed note.
- [ ] 3.2 *(Follow-up, outside this iteration.)* On a phone-width screen, show three days at a time instead of scrolling the week sideways.

## 4. The chat onboarding step

- [ ] 4.1 After the place answer, run the classifier on the onboarding scan and send the review link on every channel; after **확인**, queue the slot image for the current review with the confirmed notes not blocking it; send the image directly when there are no candidates or the host skips. Update `agent/instructions/host-imessage.ts` and `lib/server/channel-texts.ts` in English and Korean. Verify integration tests through the Photon stand-in for review then image, no candidates, a skip and a replayed confirmation. On the review's done view, add one quiet line under the freed entries that the open times will follow in the chat ("가능한 시간을 메시지로 보내드릴게요"), shown only for a host whose onboarding is waiting for that image.

## 5. Settings

- [ ] 5.1 Link the review from the existing settings dialog and `/app` setup, show earlier decisions with their writeback state and allow changing one. Verify a Playwright test for undoing a freed note.

## 6. Weekly check

This group may move to the next iteration if the schedule slips; tasks 1–5 stand without it.

- [ ] 6.1 Add the weekly pg_cron schedule (hand-written migration, mirrored in `supabase/schemas/app/cron/`) that publishes one durable job per ready host; each job scans afresh, selects new, changed or unanswered candidates, classifies them and records a review without titles. Verify integration tests for only-new entries, nothing new and a replayed job.
- [ ] 6.2 Send the numbered list on iMessage and Telegram, and on WhatsApp inside the window, or the template with the link outside it, with titles quoted as data. Verify integration tests through the stand-ins for each channel, a closed window and a refused template.
- [ ] 6.3 Add `choose_note_items` and `confirm_note_items` for linked-conversation turns with the read-back before freeing. Verify integration tests for read-back then yes, an unclear answer, keep busy by number, a stale list, the same words on the web, and a listed title written as an instruction.

## 7. Documents

- [ ] 7.1 Update the PRD ([calendar analysis dimensions](../../../documentations/02_product_requirements.md#calendar-analysis-dimensions) and FR-04), `documentations/user_experience/05_host_onboarding_flow.md`, and regenerate their `ko/` mirrors.

## 8. Release

- [ ] 8.1 Teammate review of D1–D11.
- [ ] 8.2 On a real iPhone, onboard through the note step and record that the review link, the confirmed note's writeback in Google Calendar and the slot image arrived in order; receive one weekly list and free an entry by number.
