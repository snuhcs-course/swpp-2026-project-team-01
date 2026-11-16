# Proposal

Tracking issue: #197

## Why

After a guest agrees, the booking page moves to a waiting card without an immediate acknowledgment of the successful action. The guest can mistake agreement for a booking or leave unsure whether the request was received and where to watch for a decision. The current guest journey is described in the [guest booking flow](../../../documentations/user_experience/06_guest_booking_flow.md) and the [meeting requests specification](../../specs/meeting-requests/spec.md).

## What Changes

- A successful agreement command opens a short confirmation dialog immediately. It says only that the request was sent and offers **View request**. Dismissing it returns focus to the waiting card, which explains the pending approval and delivery channels. A failed command instead opens a short retry alert; an unavailable time asks the guest to choose another one, and an uncertain result asks them to check status before retrying. A reload does not reopen an alert.
- The persistent waiting card explicitly says the request is awaiting host approval and nothing is booked yet.
- It names the guest's contact email as the destination for the host's decision and explains that a linked iMessage or WhatsApp channel can carry updates too.
- The card shows a sent agreement email and its actual recipient only when the agreement email work in #178 reports a confirmed send. This change adds the view field and conditional presentation; #178 will supply the delivery status.
- Tests cover successful and failed dialogs, waiting copy at mobile and desktop widths, and the conditional sent state.

## Scope and dependencies

This change implements the guest browser feedback and waiting-card explanation. It does not send an agreement email. The #178 implementation must populate `agreementEmailSentTo` only after confirmed delivery. The [guest flow change](../guest-flow-completion/proposal.md) owns the current thread layout and messaging link controls; this change adds the one-time dialog and persistent status text. The [guest WhatsApp change](../guest-whatsapp-link/proposal.md) already handles WhatsApp's delivery window. Telegram is a [host-only channel](../host-telegram-channel/proposal.md).
