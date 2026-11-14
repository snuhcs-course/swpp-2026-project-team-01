# Proposal

Tracking issue: #184

## Why

After setup, a returning host needs a quick view of existing commitments and meetings booked through Find Me a Time. Opening the setup conversation by default makes that overview hard to find.

## What Changes

- A ready host lands on a calendar Dashboard at `/app` after sign-in. Incomplete setup still resumes the existing conversation.
- The Dashboard combines events from the host's selected Google calendars with confirmed Find Me a Time bookings. The sources use distinct colors and labels, and a booking that also appears in Google Calendar is shown once.
- Week and month views, source filters, day details, and period navigation help the host inspect the schedule. Calendar times use the host's saved timezone.
- The existing Settings dialog and workspace menu actions remain available. The menu adds Dashboard navigation for ready hosts; Setup, Requests, iMessage, Connected agents, and Sign out keep their existing destinations.

## Decisions

The user approved the calendar prototype on 2026-11-14 and asked for English UX copy. The heading is **Your week comes together here.** in bold sans-serif type, with **See your plans and the meetings Thyme booked for you, side by side.** beneath it. No message-channel status line appears because a host connects one channel at a time.

## Capabilities

### Modified Capabilities

- `chat-workspaces`: the default entry for a ready host becomes the calendar Dashboard; setup and request work remain conversation based.

## Impact

- `/app`, the host workspace menu, a host-only dashboard API, and a calendar projection from selected Google calendars and confirmed bookings.
- No schema migration or new provider grant is required.
