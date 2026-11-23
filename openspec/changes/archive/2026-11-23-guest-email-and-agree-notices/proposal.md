# Proposal

## Why

The testing baseline's G03 Acceptance 2–3 and the wiki's guest story say a guest can recover from a mistyped address, that replies to emails reach the guest conversation, and that the assistant can help a guest get their booking link again. The code does none of these: the only contact operations are **Send again** and **Use verified Google email**, so a bounced address cannot be replaced; the booking confirmation's Reply-To is the host, so a guest's reply skips Thyme; and the assistant has no resend tool. The repository owner decided on 2026-11-23 to build all three ([#332](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/332)).

A guest who agrees to a proposal also hears nothing in their linked iMessage, WhatsApp or Telegram chat until the host decides, so they cannot match later messages to what they sent ([#179](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/179)). The same notice by email is [#178](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/178), a teammate's; this change shares the notice's shape so it can reuse it.

## What Changes

- **Change email after a bounce.** When the creation email to an unconfirmed contact is rejected or suppressed, the booking page's status line offers **Change email**. The new address replaces the contact and gets the creation email with the booking link and its own confirmation link, under the creation-email bounds. Nothing else about the request changes.
- **Replies to the booking confirmation reach Thyme.** The guest's confirmation email replies to the product inbox when the deployment has one, and says so. An authenticated reply from the address the confirmation went to, while it is still the request's contact, is forwarded into that request's requester discussion and answered by email, as a started thread is. Without an inbox, and on the host's copy, Reply-To stays the other participant.
- **Resend from chat.** The requester assistant gets `resend_booking_link`. It emails the request's booking link to the confirmed contact address only, under the **Lost your booking link?** limits, for an open or booked request. An unconfirmed contact gets nothing and the assistant says why.
- **Agreement notice in linked chats.** When a guest with an active iMessage, WhatsApp or Telegram binding agrees, or links while their agreement waits for the host, the chat gets one message with the people, purpose, date and time with the named timezone, duration, and online or the place, saying it waits for the host's approval and is not booked (or that the booked meeting stands, for a change), with no booking link. One per agreed version and binding; a version the guest reopened or the host decided is not sent. The fixed copy is English (decision log "Product language"). `lib/server/agreement-notice.ts` reads and words the summary so #178's email can reuse it.

## Decisions

- **D1** The address can change only while the contact is unconfirmed and its latest creation email was rejected or suppressed. Rejected: any time from the page, which would let a delivered or confirmed contact be replaced without the review flow.
- **D2** A confirmation reply is matched by the sender being the delivery's recipient and the request's current contact, with AgentMail authentication, and the confirmation named by In-Reply-To or References when one is, else the latest. Rejected: a per-request reply address, which AgentMail inboxes do not offer; matching by subject, which is ambiguous.
- **D3** The chat resend sends only to a confirmed address, as the issue proposed. Rejected: re-sending the creation email to an unconfirmed contact, which the page's **Send again** already does.
- **D4** The agreement notice is keyed by version and binding, so a guest who links after agreeing gets it and a retry sends no duplicate.

## Capabilities

### Modified Capabilities

- `email-delivery`: the guest's booking confirmation replies to the product inbox, and replies reach Thyme; address change after a bounce; resend from the conversation.
- `meeting-requests`: the agreement notice in the guest's linked chat.

## Impact

- Code: `lib/server/contact-confirmation.ts`, `link-resend.ts`, `booking-notices.ts`, `booking-emails.ts`, `email-receipts.ts`, `email-delivery.ts`, `request-tools.ts`, `imessage-notices.ts`, `imessage-notice-job.ts`, `request-proposals.ts`, `requester-imessage-bindings.ts`, new `agreement-notice.ts`; `agent/tools/request.ts`, `agent/instructions/requester.ts`; `apps/web/app/_components/requester/cards.tsx`; `lib/contracts/requester-view.ts`.
- No schema change.
- Tracking issues: #332, #179.
