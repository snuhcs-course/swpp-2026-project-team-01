# Proposal

## Why

Issue [#333](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/333) found that the accepted testing baseline promises controls which linked messengers do not yet provide. Hosts need to revoke Calendar access without leaving the conversation, and guests who opted into messenger updates need an effective way to stop and later opt in again.

## What Changes

- Let a host explicitly disconnect Google Calendar from their linked iMessage, WhatsApp, or Telegram conversation. Remove the saved provider grant and calendar selections, pause new requests until setup is completed again, and preserve existing events and bookings.
- Handle a guest's exact `STOP` (and Telegram `/stop`) before the assistant receives it. Stop future messages on that guest's messenger subscriptions, suppress messages still queued, confirm the stop, and explain that the guest can opt in again from the booking link in their email.
- Update the testing baseline to record the implemented behavior and remove stale claims about host disconnect and messenger instructions for switching agents.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `host-setup`: Hosts can disconnect their saved Calendar grant from a linked messenger with the same readiness, setup, event, and booking effects as the existing web control.
- `meeting-requests`: A guest can stop messenger updates before their message reaches the assistant and opt in again through the request's booking page.

## Impact

- Affected code: host setup agent tools and instructions; host Calendar disconnect transaction; messaging command routing, requester bindings, and localized replies.
- Affected tests: setup-tool and messenger receipt integration coverage, including guests with multiple active request bindings and suppression of queued notices.
- Documentation: `documentations/technical_specification/12_testing_baseline.md`; the issue's decision is already recorded in `documentations/user_experience/02_user_stories.md`.
- No schema or dependency change is expected; existing encrypted requester bindings and outbox states can represent the opt-out and re-link lifecycle.
