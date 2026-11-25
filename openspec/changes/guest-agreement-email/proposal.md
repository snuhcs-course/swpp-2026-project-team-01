# Proposal

Tracking issue: #178

## Why

The creation email reaches the guest when they identify themselves, before they agree to a meeting proposal. After agreement the request awaits host approval, but no email records what the guest sent. The guest cannot use their inbox to distinguish that request from later booking updates.

## What Changes

- Send a separate English agreement receipt to the guest for each agreed proposal version, with the people, purpose, proposed date and time in the guest's named timezone, duration, meeting type and place or online status.
- State that the request reached the host, approval is pending and booking is unconfirmed; link the private request page with **View request**. Match the existing transactional email design without an address-confirmation action.
- Freeze the agreed version and recipient, deduplicate retries, and show a sent-recipient line on the guest waiting card only after confirmed email delivery.

The existing `request_creation` email remains the earlier link and optional address-confirmation email. This change uses the agreement summary shared with linked chat notices by the archived `guest-email-and-agree-notices` change. The `guest-waiting-decision` change owns the waiting card's conditional display.
