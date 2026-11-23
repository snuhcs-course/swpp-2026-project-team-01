# Proposal

Tracking issue: #376

## Why

When nobody says how long a meeting is, the service falls back to 30 minutes, which is shorter than most meetings the team books (team request, 2026-11-23). The fallback is also written as four separate literals, so changing it once leaves the others behind.

## What Changes

- One shared constant, `DEFAULT_MEETING_MINUTES` in `lib/contracts/setup.ts`, holds the default meeting length, and it is 60 minutes.
- The setup starter default for **Meeting length** (`STARTER_DEFAULTS.durationMinutes`), used when the calendar scan counted fewer than 5 meetings, is 60 minutes.
- The guest view of the host's offer, when the host's settings hold no meeting length, shows 60 minutes.
- The tutorial's sample request is a 60-minute meeting.
- The host's **Suggest changes** form and its change summary start from 60 minutes when neither the current proposal nor the request has a length.

Unchanged: a length the host saved in setup, a length inferred from the calendar scan, and a length a guest or host stated. The manual trip allowance in the host's rule review keeps its own 30-minute starting value, because it is travel time, not meeting length.

## Decision

Existing hosts keep the length they saved, including hosts who accepted the old 30-minute starter default: their confirmed settings are not rewritten, because a confirmed setting is the host's policy and the service cannot tell an accepted starter default from a deliberate 30. Whether to move those hosts to 60 is left to the team (#376 notes).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: a requirement names the one default meeting length and where it applies.

## Impact

`lib/contracts/setup.ts`, `lib/server/requester-routes.ts`, `lib/server/host-tutorial.ts`, `apps/web/app/_components/host/host-request-cards.tsx`, their unit tests, the [product requirements](../../../../documentations/02_product_requirements.md) rule configuration row, and the starter-default tables of the [`host-onboarding`](../../host-onboarding/design.md#5-starter-defaults-and-suggestions) change. No schema change and no data migration.
