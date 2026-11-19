## Why

New hosts see the request review controls for the first time when a real guest is waiting for a decision. Issue #296 adds a practice request at the end of onboarding.

## What changes

- Offer one optional tutorial after the first successful setup save, in the web workspace or a linked Telegram, iMessage, or WhatsApp conversation.
- Show a clearly marked sample through the existing request review flow. Let the host inspect it, ask Thyme questions, approve it, decline it, request a change, or end the tutorial.
- Keep practice decisions free of external side effects and remove the sample from the inbox when it finishes.

The detailed contract extends [meeting requests](../../../specs/meeting-requests/spec.md) and follows the existing [host onboarding flow](../../../../documentations/user_experience/05_host_onboarding_flow.md).

## Capabilities

### Modified Capabilities

- `meeting-requests` — Optional host practice request.

## Impact

Host setup, request review, the shared messaging pipeline, and request storage.
