# Proposal

Tracking issue: #330 (parent #325). The pull request that implements and archives this change refers to it with `Part of #330`, because the schedule image the owner also asked for is left for a follow-up (see Impact).

## Why

The [testing baseline](../../../../documentations/technical_specification/12_testing_baseline.md#h04-host-schedule-and-meeting-status) story H04 says a host sees their schedule, the requests they received and sent, and their confirmed bookings. The code fell short in two places:

- The Dashboard ([chat-workspaces: Host calendar Dashboard](../../../specs/chat-workspaces/spec.md)) showed Google events, booked meetings and sent requests, but not a received request waiting for the host's decision (H04 W-5). The host had to open Requests to see when it would be.
- In iMessage, Telegram, WhatsApp and MCP, the assistant could list requests but could not read the host's calendar, so "What's on tomorrow?" or "What's on my calendar this week?" had no answer (H04 M-2.2, M-4, P-3).

The repository owner decided on #330 (2026-11-23) to build both and a schedule image in the messenger, and not to build the weekly report the story mentioned; the weekly report leaves the baseline.

M-2 ("Which meetings are confirmed this week?") was rechecked first: since #302 the model's request list carries each request's booked or proposed time with its week and today's date, so M-2 is already supported and needs no change here.

## What Changes

- The Dashboard draws each received request that needs the host's decision (awaiting approval, or with a pending suggestion; never a sample) at its current proposal's time, with its own dashed amber treatment, a **Requests to decide** filter, and details that say it is not booked and open the request.
- A read-only `read_schedule` tool in the host's setup conversation (web and the linked iMessage, WhatsApp or Telegram), and the same as `get_schedule` on the host MCP connection under `host:read`. It returns the Dashboard projection for up to 31 local days: booked meetings, other events from the Google Calendars the host chose, requests to decide and sent requests, each labeled by kind, with local times and weeks, titles and places as quoted data, and no contact details or join links.
- The host setup instructions and the host entry document tell the assistant to answer schedule questions from that tool and never to invent events.
- The weekly report row (H04 M-6) is removed from the testing baseline.

## Capabilities

### New Capabilities

- `host-schedule-lookup`: reading the host's own schedule from the messenger conversation and MCP.

### Modified Capabilities

- `chat-workspaces`: received requests awaiting a decision on the Dashboard, added as a new requirement so the still-open [`request-dashboard`](../../request-dashboard/proposal.md) change, which modifies **Host calendar Dashboard**, is not contradicted.

## Impact

`lib/server/host-dashboard.ts` (a fourth event source), `lib/server/host-schedule.ts` (new), `lib/server/setup-channel-tools.ts`, `agent/tools/setup.ts`, `lib/server/agent-host-tools.ts`, `agent/instructions/host-setup.ts`, `lib/server/entry-documents.ts`, and the Dashboard component, labels and styles. No schema change, route, provider grant or new dependency. The Google read is the one the Dashboard already makes, over the same selected calendars.

Not in this change: the **schedule image** (H04 M-5). Every outbox `image` row is read as the latest settings preview (`confirm_settings`, the onboarding note step), and the `imessage_outbox.kind` check constraint ties `image` to a settings review hash, so a schedule image needs its own outbox kind (a migration), a renderer for events rather than open slots, and each transport (iMessage, WhatsApp, Telegram) to send it. That is a follow-up on #330. The weekly report is out of scope by the owner's decision.

Documents updated: [testing baseline H04](../../../../documentations/technical_specification/12_testing_baseline.md#h04-host-schedule-and-meeting-status), [agent configuration](../../../../documentations/technical_specification/04_agent_configuration.md), [agent clients](../../../../documentations/technical_specification/09_agent_clients.md) and [DESIGN.md](../../../../DESIGN.md).
