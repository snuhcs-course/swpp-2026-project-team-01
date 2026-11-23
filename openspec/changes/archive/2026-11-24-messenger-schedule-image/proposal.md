# Proposal

Tracking issue: #330. The pull request that implements and archives this change closes it with `Closes #330`: it is the last part the owner decided to build.

## Why

The repository owner decided on #330 (2026-11-23) that the host's messenger also sends the schedule as an image ([testing baseline H04 M-5](../../../../documentations/technical_specification/12_testing_baseline.md#h04-host-schedule-and-meeting-status)). The archived [`host-schedule-views`](../2026-11-23-host-schedule-views/proposal.md) change built the Dashboard's requests to decide and the read-only schedule lookup ([`host-schedule-lookup`](../../../specs/host-schedule-lookup/spec.md)), and left the image out ([its design 3](../2026-11-23-host-schedule-views/design.md#3-deferred-the-schedule-image)): every outbox `image` row is read as the latest settings preview (`confirm_settings`, the setup command, the onboarding note step) and the table ties `image` to a settings review hash, so a schedule image sent as `image` would make the host's next settings confirmation stale.

## What Changes

- A new outbox kind, `schedule_image`, with a migration that adds it to `imessage_outbox.kind`. It carries no review hash, so the settings preview, the review hash check and every confirm flow keep reading only `image` rows, unchanged.
- An event renderer next to `renderSlotPreviewPng`: up to seven local days of the same Dashboard projection `read_schedule` reads (`readHostDashboard`), days across and hours down, each entry coloured by kind (booked meeting, other calendar event, request to decide, sent request), all-day entries in a strip, a legend and a note when Google Calendar could not be read.
- iMessage, WhatsApp and Telegram send it as one picture with no text of its own; one that cannot be drawn sends nothing.
- A `send_schedule_image` tool in the host's setup conversation, for a message from the linked chat only, and an instruction to use it when the host asks to see the schedule as an image. It returns the same entries as `read_schedule` so the reply sums the days up in words and stands alone.

## Capabilities

### Modified Capabilities

- `host-schedule-lookup`: the schedule as one picture in the linked chat.

## Impact

`supabase/schemas/app/tables/imessage_outbox.sql` and a generated migration (`imessage_outbox_kind_check` only), `lib/contracts/schedule-image.ts` (new), `lib/server/schedule-image.ts` (new), `lib/server/slot-preview-image.ts` (shared drawing helpers exported), `lib/server/host-schedule.ts`, `lib/server/photon.ts`, `lib/server/telegram.ts`, `lib/server/imessage-outbox.ts`, `lib/server/setup-channel-tools.ts`, `agent/tools/setup.ts` and `agent/instructions/host-setup.ts`. No new dependency, route or provider grant; the Google read is the one the Dashboard and `read_schedule` already make. MCP keeps `get_schedule` in words: an MCP client has no messenger to send a picture to.

Documents updated: [testing baseline H04](../../../../documentations/technical_specification/12_testing_baseline.md#h04-host-schedule-and-meeting-status), [agent configuration](../../../../documentations/technical_specification/04_agent_configuration.md) and [user stories](../../../../documentations/user_experience/02_user_stories.md). The [implementation plan](../../../../documentations/technical_specification/06_implementation_plan.md) row for #330 already names the image and needs no change.
