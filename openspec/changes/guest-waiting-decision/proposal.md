# Proposal

Tracking issue: #197

Follow-up interface polish and explicit email-only choice: #253.

## Why

After a guest agrees, the booking page moves to a waiting card without an immediate acknowledgment of the successful action. The guest can mistake agreement for a booking or leave unsure whether the request was received and where to watch for a decision. The current guest journey is described in the [guest booking flow](../../../documentations/user_experience/06_guest_booking_flow.md) and the [meeting requests specification](../../specs/meeting-requests/spec.md).

## What Changes

- A successful agreement command opens a short confirmation dialog immediately. It says only that the request was sent and offers **View request**. Dismissing it returns focus to the waiting card, which explains the pending approval and delivery channels. A failed command instead opens a short retry alert; an unavailable time asks the guest to choose another one, and an uncertain result asks them to check status before retrying. A reload does not reopen an alert.
- The persistent waiting card's heading names pending host approval. Its body confirms submission, then explains email delivery on approval and optional iMessage or Telegram updates in one paragraph.
- An **Email updates only** button replaces the optional-email footnote. Choosing it saves a request-scoped preference, ends messaging bindings and pending link attempts, and replaces channel choices with a saved receipt. A fixed Thyme message confirms email-only updates below the waiting card. Reloads retain both the choice and its confirmation; there is no **Change** control.
- The card shows a sent agreement email and its actual recipient only when the agreement email work in #178 reports a confirmed send. This change adds the view field and conditional presentation; #178 will supply the delivery status.
- Tests cover successful and failed dialogs, waiting copy at mobile and desktop widths, and the conditional sent state.

## Scope and dependencies

This change implements the guest browser feedback and waiting-card explanation. It does not send an agreement email. The #178 implementation must populate `agreementEmailSentTo` only after confirmed delivery. The [guest flow change](../guest-flow-completion/proposal.md) owns the current thread layout and messaging link controls; this change adds the one-time dialog and persistent status text. The [guest WhatsApp change](../archive/2026-11-24-guest-whatsapp-link/proposal.md) already handles WhatsApp's delivery window. Telegram is a [host-only channel](../archive/2026-11-24-host-telegram-channel/proposal.md).
