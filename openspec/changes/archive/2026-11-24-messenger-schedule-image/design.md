# Design

## 1. Its own outbox kind

`imessage_outbox.kind` gains `schedule_image`. The `imessage_outbox_image_review` check (`kind = 'image'` exactly when `review_hash` is set) is untouched, so a schedule image can never carry a review hash and is never mistaken for a settings preview: `confirm_settings`, `confirm <ref>`, the onboarding note step and the turn reply's "a preview replaces this reply" check all keep reading `kind = 'image'`. The payload is the schedule as JSON, sealed in `text_ciphertext` like the slot image; final states clear it. The row names the host's binding, so it is suppressed when the chat is unlinked, and the turn's input, for tracing. It does not replace the turn reply. On Telegram it takes one slot of the chat's spacing (the slot image takes two, for its picture and its text).

## 2. The picture's data

`scheduleImageOf` in `lib/server/host-schedule.ts` reads the same `readHostDashboard` projection `read_schedule` reads, for 1 to 7 local days in the host's timezone (default seven from today), and lays it out by day: a timed event is cut at each local midnight it crosses (`00:00` to `24:00` at most), an all-day event is listed on each day it covers, and each entry keeps its kind. The grid spans 09:00 to 18:00, widened to whole hours that cover every timed entry. Titles stay as the calendar has them (cut at 80 characters): only the host sees the picture, and it is never read by a model. When Google Calendar cannot be read, the picture says so and draws only Find Me a Time meetings and requests.

## 3. The renderer

`renderScheduleImagePng` in `lib/server/schedule-image.ts` reuses the slot image's canvas, header, headline, board, fonts and `next/og` rendering, which `slot-preview-image.ts` now exports, so both pictures look alike and need no network at render time. Kinds follow the Dashboard: booked meetings filled ink blue, other Google events grey, requests to decide dashed amber, sent requests outlined. Overlapping entries share a day in side-by-side lanes. The picture is English in every conversation, like the slot image; the reply carries the host's language.

## 4. Sending and the tool

Each transport sends the picture alone: Spectrum's attachment on iMessage and WhatsApp, `sendPhoto` with no caption on Telegram. A picture that cannot be drawn sends nothing and the row fails with `render_failed`; unlike the slot image there is no fallback text, because the turn's reply already says the schedule in words.

`send_schedule_image` is a setup-session tool behind `authorizeSetupTool`. It works only for a message from the linked chat (`linkedMessagingTurn` and the active binding on the same channel), so the picture goes where the host asked; otherwise it tells the model to answer from `read_schedule`. Its command rechecks the turn and the binding under the setup lock and records one row per tool call (`schedule-image:{binding}:{callId}`), so a retried call is one picture. It returns the model projection for the same days, so the reply sums them up without a second read. MCP keeps `get_schedule` only.
