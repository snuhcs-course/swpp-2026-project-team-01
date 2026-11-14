# Proposal

## Why

After Google sign-in, a new host currently sees web setup questions and can defer messaging. The intended experience begins with a verified messaging connection, then completes setup and delivers the first booking link in that conversation. Tracked by [#190](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/190).

## What Changes

- **BREAKING**: Require a new, incomplete host to choose and verify iMessage, WhatsApp or Telegram before accessing setup in `/app`; remove the browser's defer and web-chat setup path from that entry.
- Keep Google sign-in, messaging link verification and necessary Google Calendar consent in the browser. The linked conversation owns calendar roles, suggestions based on the recent four weeks, place choices, next week's slot review, confirmation and the first booking link, as described in [host onboarding in chat](../host-onboarding-in-chat/proposal.md).
- Show a recoverable linking error when channel status cannot load or the selected provider fails. Preserve the existing workspace for hosts who completed setup.
- Update the [host onboarding flow](../../../documentations/user_experience/05_host_onboarding_flow.md) and [PRD](../../../documentations/02_product_requirements.md).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `chat-workspaces`: The first signed-in view for an incomplete host becomes mandatory messaging selection and verification before the conversation moves to the linked app.

## Impact

`/app` link step and localized copy, channel deep links, host onboarding documentation and link-flow tests. No new provider API is introduced. Live Photon and Telegram delivery remains subject to the existing channel changes' device acceptance work.
