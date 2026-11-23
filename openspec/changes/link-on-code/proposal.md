# Proposal

Tracking issues: #412 (host links) and #383 (a guest's Telegram link)

## Why

To link iMessage, WhatsApp or Telegram, a person sends a one-time code from the messenger and then has to go back to the browser and press **Confirm and link** on **Is this you?** (host links, [`host-imessage-channel`](../host-imessage-channel/proposal.md) D3 and D15, [`host-telegram-channel`](../host-telegram-channel/proposal.md) D6) or **Is this your Telegram?** (guest links, [`guest-flow-completion`](../guest-flow-completion/proposal.md) design 1, [`guest-telegram-link`](../guest-telegram-link/proposal.md) D3). The trip back to the browser after texting is the step the owner wants gone. On a computer it also made the Telegram start link replace the page that held the confirmation (#369). In team QA on 2026-11-23 the guest's second tap felt unnecessary (#383).

The repository owner decided on 2026-11-23 (#412): a messenger links as soon as the person sends a valid code, for hosts and guests alike.

## What Changes

- **Link on arrival.** A pending, unexpired code from a direct conversation on the attempt's channel binds its sender at once: to the host for a host's code, to the request for a guest's code. The messenger gets the linked message (one line for a ready host or a guest; the welcome into setup for a host still setting up), so setup continues there. The **Is this you?** / **Is this your Telegram?** screen, **Confirm and link**, **This isn't me**, the `imessage.link.confirm` and `request.imessage_link.confirm` commands and the "Got it. Go back to … and tap Confirm and link" reply are removed.
- **The page notices by itself.** The page that showed the code already polls while it is pending; it now moves straight to **Linked** with the sender's last four digits, Apple ID or Telegram name, and offers **Not my number — unlink** (**Not my Telegram — unlink** on Telegram), which runs the existing unlink command.
- **The iMessage start.** A code sent from the landing page's start before sign-in still waits for Google sign-in in that browser or from Thyme's sign-in link (D19). The sign-in now binds the sender instead of leading to **Confirm and link**.
- **What stands in for the confirmation.** The code is single-use (used, voided and replaced codes never link again), valid 15 minutes, owned by the signed-in account, the request or the start's browser that showed it, and limited to 5 per owner per hour; a code from a group or another channel voids it. These limits already existed; this change states them as the safeguard and records the remaining risk: a code that leaks before it is used links whoever sends it first.
- **Agent-led links.** The `/connect/link/<token>` page an agent hands out moves from the code to "Linked" and no longer confirms anything.

## Decisions

Taken by the repository owner on 2026-11-23 (#412, folding in #383). D2 to D5 were worked out in the session that wrote this change from that decision.

| # | Decision | Choice |
|---|---|---|
| D1 | When a link happens ([design 1](design.md#1-linking-on-arrival)) | As soon as a valid code arrives from a direct conversation on the attempt's channel, for host and guest attempts on iMessage, WhatsApp and Telegram. Rejected: keeping **Confirm and link** (the extra trip back to the browser); a reply that only says "go back to your browser" (#398 rejected it too) |
| D2 | Recovery ([design 2](design.md#2-recovery-not-my-number)) | The linked screen names the sender (last four digits, Apple ID or Telegram name) and offers **Not my number — unlink**, the existing `imessage.unlink` or `request.imessage_link.unlink` command; the person can then make a new code. Rejected: an email to the guest on every link (#383's suggestion), left for later |
| D3 | Safeguards and remaining risk ([design 3](design.md#3-safeguards-and-remaining-risk)) | Single-use, 15 minutes, owned by the session that showed it, 5 per owner per hour, refused from groups and other channels, and a sender another host holds is refused. A leaked code links the wrong number; for a host that number can then act for the host in the messenger (approve meetings) until **Unlink**. Rejected: a shorter expiry, since people who switch apps need the time and the risk window is the time before the person sends their own code |
| D4 | The sender on screen ([design 4](design.md#4-the-sender-on-screen)) | A linked number is shown as `•••• 1234`, an Apple ID email in full, a Telegram sender by first name and @username. Rejected: the whole number, which #118 wanted only so the person could check it before confirming |
| D5 | The iMessage start ([design 5](design.md#5-the-imessage-start-before-sign-in)) | A code that arrives before sign-in is recorded as before; the browser's Google sign-in, or the sign-in from Thyme's reply, binds it. Rejected: binding with no host (there is no account yet) |

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `host-imessage-channel` (unarchived, in [`host-imessage-channel`](../host-imessage-channel/proposal.md)): a host's code links on arrival; the link step, the iMessage start and the card show **Linked** with **Not my number — unlink**. The same applies to WhatsApp and Telegram through `host-whatsapp-channel` and `host-telegram-channel`, whose deltas this change updates in place.
- `requester-imessage-channel` (unarchived, in [`guest-flow-completion`](../guest-flow-completion/proposal.md)): a guest's code links on arrival on every channel; `guest-whatsapp-channel` and `guest-telegram-channel` deltas are updated in place.

The capabilities above exist only in unarchived changes, so this change adds its requirement as ADDED and edits those changes' deltas so they do not contradict it. It is archived after them.

## Impact

- `lib/server/imessage-links.ts` (`receiveLinkCode` binds; `bindReceivedAttempt`; the confirm command removed), `requester-imessage-links.ts`, `imessage-start.ts`, `google-sign-in.ts`, `connect-link.ts`, `connect-link-routes.ts`, `imessage-receipts.ts`, `imessage-routes.ts`, `requester-routes.ts`; `lib/contracts/imessage.ts` and `requester-imessage.ts` lose the `received` card state (the start keeps it).
- `apps/web`: the `/app` link step, the landing popup and iMessage start, the Connect card, the booking page's channel card and the agent-led link page.
- No schema change. `imessage_links.state = 'received'` stays for the iMessage start; host and guest attempts now go from `pending` to `linked`.
- Documents: PRD, user journeys, interfaces, page list, guest booking flow, agent configuration, testing baseline, decision log, and their `ko/` mirrors.
