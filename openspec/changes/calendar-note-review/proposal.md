# Proposal

Tracking issue: TBD

## Why

People write notes in Google Calendar ("헬스", "엄마 생일", "과제 마감") and leave Google's default **Busy** in place, so every note blocks time a guest could book. Today the scan only lists every entry the host wrote alone (no other attendee, no location, no link) as "looks like a note" ([`host-onboarding`](../host-onboarding/specs/host-setup/spec.md), "Analysis evidence dimensions"), and the web card starts with nothing ticked. That rule cannot tell a gym session from a birthday reminder. The chat onboarding of [`host-onboarding-in-chat`](../host-onboarding-in-chat/proposal.md) (#175) has no note step at all: `noteExclusions` cannot be filled from the chat, so the slot image shows next week with the notes still blocking it. And nothing looks at notes again after setup.

The Iteration 4 kickoff (2026-11-08) gave this work to 최해성 and decided: block conservatively at first, let the host turn notes into available time from settings, let an AI mark candidates that a person confirms, and classify week by week. The meeting accepted that until a week is checked, some open slots may stay hidden from guests.

## What Changes

- **An AI recommends; the host decides.** Opaque events with no other attendee, all-day ones included, go to a separate classifier call (no tools, a strict schema, titles as data). It recommends each as a note, an event or unsure. A recommendation frees nothing.
- **A confirmed note becomes free in Google.** The service writes `transparency: "transparent"` back to the event with the scope it already holds, so the time is free for guests and for anyone who sees the host's free/busy. A failed write keeps the time busy, is retried as a durable job and is shown to the host. A recurring note changes for the whole series by default, or for one occurrence. Calendars the host cannot change keep the decision in our database only.
- **One review page.** The web page lists the candidates with the AI's recommendations marked and pre-ticked, and says that confirmed notes are shown as free in Google Calendar. It is reached from the chat onboarding, the weekly check and the settings.
- **Chat onboarding gains a note step.** Between the place question and the slot image, Thyme's flow sends the review page link on every channel. The slot image is sent after the review, so it shows next week without notes blocking it.
- **A weekly check.** Once a week the service scans for new or changed candidates only and asks about them: a numbered list with the link on iMessage and Telegram, and on WhatsApp the same list inside the 24-hour window or a template notice with the link outside it. A reply by number is read back once before anything is freed. Answers of both kinds are remembered and not asked again.

## Decisions

The user took D1–D10 on 2026-11-13 in the session that prepared this change, from the kickoff decision of 2026-11-08; D11 records the agreed placement of the settings entry. They have had no teammate review yet; task 8.1 covers them.

| # | Decision | Choice |
|---|---|---|
| D1 | What is judged ([design 1](design.md#1-what-is-judged)) | Only events whose transparency is opaque (Google's default) and that have no other attendee go to the AI. An event with another attendee is a real event and is not sent. All-day events count as opaque and are included. The current rule (no attendee, location or link) cannot separate "헬스" from "엄마 생일", so the AI judgment is the core of this change and comes first |
| D2 | Separation ([design 2](design.md#2-the-classifier)) | The classifier is its own model call, apart from Thyme, with no tools and only a strict-schema output `{id, verdict: note \| event \| unsure, reason}`. Titles are data, not instructions (OWASP LLM01). The conversational Thyme sees titles only in the weekly list and its read-back, as quoted data like calendar names; hiding them from Thyme was considered and dropped (user, 2026-11-13) as not worth the extra plumbing |
| D3 | Effect ([design 3](design.md#3-recommendations-and-decisions)) | An AI verdict is a recommendation only. The time stays busy until the host confirms |
| D4 | Writing back to Google ([design 4](design.md#4-writing-free-back-to-google)) | A note the host confirms is written back to Google Calendar as `transparency: "transparent"` (required, user decision). The existing `calendar.events` scope allows `events.patch`, so no new consent is asked. The page says "Google 캘린더에 한가함으로 표시합니다". A failure keeps the time busy, is retried as a durable job and is shown on screen. For an invited event only the host's copy changes. The page tells the host that colleagues who see their free/busy will also see the time as free |
| D5 | Recurring events ([design 5](design.md#5-recurring-notes)) | By default the whole series (the event named by `recurringEventId`); a choice for this occurrence only is offered |
| D6 | Calendars that cannot be changed ([design 6](design.md#6-calendars-that-cannot-be-changed)) | For subscribed or read-only calendars the decision is recorded only in our database, through the existing `noteExclusions` |
| D7 | Confirming from the chat ([design 8](design.md#8-the-note-step-in-chat-onboarding), [design 10](design.md#10-the-weekly-check-by-channel)) | **Onboarding:** between the place question (step 4 of the #175 flow) and the slot image (step 5), every channel gets the web review page link: the host compares several candidates with the AI's marks at a glance, which suits a page, and the WhatsApp window is open because the host has just replied. The slot image is sent after the review, so it shows open time not blocked by notes. **Weekly, iMessage (Photon) and Telegram:** both can send a linked host a free-form message at any time, so the service sends a numbered list with the link, and the host can answer by number ("1, 3번 비워줘"). **WhatsApp:** after 24 hours from the host's last message Meta allows only approved templates, and the PRD keeps private event content out of templates. With the window open, the same list as iMessage is sent. With it closed, a template notice ("확인할 새 일정이 있어요") with the link is sent, and the list follows once the host replies and the window opens. When no template can be sent (template registration and Meta's review are not finished, PR #110), the candidates stay busy until the next weekly check. **Rejected:** a link only on every channel (one more step for iMessage hosts); titles inside the template (against the privacy rule and Meta's approval) |
| D8 | Freeing by a chat reply ([design 11](design.md#11-answering-by-number)) | Before freeing anything the service asks once more, such as "1번 엄마 생일, 3번 과제 마감을 비울까요?", because turning busy into free is the riskier direction. Aligned with [`agent-decisions-in-words`](../agent-decisions-in-words/proposal.md) and [`channel-actions-in-words`](../channel-actions-in-words/proposal.md) |
| D9 | Remembering "keep busy" ([design 3](design.md#3-recommendations-and-decisions)) | A host's answer that an entry is a real event is stored too and not asked again (today only exclusions are stored) |
| D10 | Weekly check ([design 9](design.md#9-the-weekly-check)) | Once a week from pg_cron, as durable jobs. Only events that are new or changed since the last check are judged again. New events stay busy until checked: the limitation accepted at the 2026-11-08 meeting, that some slots may be hidden from guests until the check. Analysis results are kept for 24 hours ([calendar analysis retention](../../specs/calendar-analysis-retention/spec.md)), so every check scans afresh |
| D11 | The settings entry ([design 12](design.md#12-reviewing-again-from-settings)) | The host can review notes again from the web settings at any time after onboarding. The new settings screen is being redesigned by 유진 and has no code yet, so this change extends the existing `NotesStep` and builds the review as a standalone component that can move into the new screen later. The design mock-ups are in Slack and are taken when implementing |

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `host-setup`: the note definition becomes an AI recommendation; the classifier, writing free back to Google with its failure handling, recurring notes, calendars that cannot be changed, remembered answers, the review page, the weekly check and reviewing again from settings.
- `host-imessage-channel`: the note step in chat onboarding before the slot image, and the weekly check on iMessage and Telegram with answers by number. Telegram follows the iMessage channel's rules under [`host-telegram-channel`](../host-telegram-channel/specs/host-telegram-channel/spec.md), "Telegram conversation behavior", so it has no delta of its own.
- `host-whatsapp-channel`: the weekly check inside and outside the 24-hour window.

## Impact

- New: the classifier module (beside `lib/server/host-schedule-image-openai.ts`, which it follows), a note decision record and its migration, a writeback job kind, a weekly pg_cron schedule (`supabase/migrations/`, `supabase/schemas/app/cron/`), the review page and its standalone component. No evaluation set is declared for the classifier: every recommendation is checked by the host before it frees time (user, 2026-11-13).
- Changed: `lib/server/analysis.ts` (candidate selection), `lib/server/feasibility.ts` `normalizeBusy` (remembered decisions), `lib/server/google-calendar.ts` (`events.patch`), `lib/contracts/setup.ts` (`noteExclusionSchema`), `apps/web/app/_components/setup/analysis-card.tsx` (`NotesStep`), `lib/server/setup-channel-tools.ts` (`preview_next_week` after the review), `lib/server/channel-texts.ts`, the outbox and the WhatsApp template sender, `agent/instructions/host-imessage.ts`.
- Documents: the PRD ([calendar analysis dimensions](../../../documentations/02_product_requirements.md#calendar-analysis-dimensions), FR-04), [`05_host_onboarding_flow.md`](../../../documentations/user_experience/05_host_onboarding_flow.md) and their `ko/` mirrors.
- Related: the settings redesign (유진), which will host the review component; the WhatsApp template registration (PR #110).
