# Proposal

## Why

Phase 6 of the [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md#phase-6--host-imessage-channel) starts with a fresh OpenSpec change that replaces the retired iteration-1 `imessage-agent` spec and `host-imessage-assistant` change ([OpenSpec status](../../README.md)). Every later iMessage behavior (commands, proposal review, setup over iMessage) needs a verified binding between a host and a phone number first.

The team agreed on the phone check screens built on 2026-10-18 (commits `b576a88`, `d5249bf` and `d3ca3be` on `feat/web-onboarding-redesign`, contract `apps/web/src/contracts/phone-link.ts`). They differ from the linking flow the [PRD](../../../documentations/02_product_requirements.md#10-dependencies-and-open-decisions) selected on 2026-10-19. This change adopts the screens as the linking design, records every difference below, and updates the owning documents to match.

## What Changes

- **Phone check.** The host enters a mobile number and taps **Text me**. Thyme texts that number on iMessage, and the screen shows a 2-digit number. The host replies to the text with that number, and the reply from that number in that conversation links it to the host.
- **Two starts.** Google first (`/`): the number step follows sign-in in `/app`, and the host can skip it for the web chat. iMessage first (`/?flow=imessage`): the number goes in on the landing, before any account exists, and onboarding continues with Thyme in iMessage once the number is checked.
- **Phone accounts.** On the iMessage start, a checked number that no host holds creates an active host account, so a phone becomes a way to sign up and sign in alongside Google. The host links Google later for Calendar access, which scheduling still needs.
- **Limits.** A number lasts 5 minutes. Asking again never waits on screen; the server sends no sooner than a minute after the last text. A wrong reply replaces the number. Three wrong replies fail the check for 5 minutes. When no more texts are allowed, the phone is put off and the host can ask to hear when texting works again, by iMessage or, once signed in, by email.
- **After the check.** A connected host on the Google start goes to `/home` or the web chat. The iMessage start continues in Messages, with Google sign-in on the same page.
- **Server contract.** `POST` and `GET /api/host/imessage/connection`, `POST /api/host/imessage/connection/retry` and `POST /api/host/imessage/notify`, with the `PhoneLink` shape the screens already draw.
- **Transport spike.** The Phase 6 Lane A spike, extended to the facts this flow depends on: whether Photon can open an outbound iMessage conversation to a new number and report a non-iMessage recipient, the exact sender identifier, and what an uncertain send looks like.

Out of this change, for a later Phase 6 change: exact iMessage commands, proposal summaries and decisions over iMessage, setup over iMessage, and the optional contact card.

## Differences from the current documents

The screens win wherever the two disagree. Each row names the document text this change replaces; task 3 updates them.

| # | Topic | Current documents | This change (the agreed screens) | Owning text to update |
|---|---|---|---|---|
| D1 | Who sends first | The host sends a one-time link code from their own iMessage (**Open Messages**, **Copy**); the service's first message is a reply | Thyme sends the first text to the number the host entered | PRD §10 iMessage paragraph; [provider setup](../../../documentations/technical_specification/03_provider_setup.md#first-message-and-host-onboarding); backend architecture iMessage paragraph; frontend architecture link card; H11; page list *Channel link*; interfaces; user journeys; user stories |
| D2 | What proves the number | Host-sent link code, or a service-sent six-digit code typed into the browser | A 2-digit number shown on screen, sent back as a reply in Thyme's conversation | Same as D1 |
| D3 | Code shown in the browser | "The website never displays a code it sent" | The screen shows the number the host must send back; the text itself carries no code | [Interfaces](../../../documentations/user_experience/03_interfaces.md) |
| D4 | Final confirmation | **Confirm and link** on the masked sender in the browser | The matching reply links the number; no extra browser step | H11; page list; frontend and backend architecture |
| D5 | Fallback | **Send me a code instead** (service-sent six-digit code) | No second linking path. A failed check offers **Enter the number again**, **Connect again** after a lockout, or puts the phone off with **Text me when it's back** / **Email me when it's back** and **Contact us** | H11; page list; PRD §10 |
| D6 | When it happens | Optional H11 step after setup review, or **Connect iMessage** later in `/app` | Right after sign-in, before the setup chat, with **Set up here in web chat** to skip | [Host onboarding flow](../../../documentations/user_experience/05_host_onboarding_flow.md) |
| D7 | iMessage-first start | Leads to the authenticated browser flow and grants no private access | The number is checked on the landing before sign-in, creates the host account (D10), and onboarding continues in iMessage; Google sign-in stays available on the page | PRD §5 and §10; host onboarding flow; user journeys |
| D8 | Deliverability rationale | Inbound-first to avoid the "Report Junk" banner and the line's new-conversation allowance | Accepts both costs; see the [design](design.md#trade-offs) | Provider setup; PRD §10; implementation plan risk table |
| D9 | Implementation plan | Lane B: link code card with **Copy**, **Open Messages**, **Confirm and link** and the six-digit fallback | Lane B ports the agreed screens to `apps/web/app` | [Implementation plan](../../../documentations/technical_specification/06_implementation_plan.md#phase-6--host-imessage-channel) Phase 6 and risk table; [OpenSpec status](../../README.md) |
| D10 | Host accounts | Google sign-in is the only way to create or enter a host account (FR-35) | A checked iMessage number also creates and signs in to a host account; Google is linked to it later | PRD §3, §5, FR-35; [chat-workspaces](../../specs/chat-workspaces/spec.md) *Google-only MVP host login*; [host-admission](../../specs/host-admission/spec.md); [email-delivery](../../specs/email-delivery/spec.md); [public-agent-entry](../../specs/public-agent-entry/spec.md); [provider setup](../../../documentations/technical_specification/03_provider_setup.md) |

The documents and the screens agree on these, so they stay as written: linking is optional and web setup works without it; a number linked to one host cannot link to another; group conversations and unlinked senders get no private state; linking proofs stay out of the transcript and model context ([chat-workspaces](../../specs/chat-workspaces/spec.md)); unlinking is required ([FR-26](../../../documentations/02_product_requirements.md)); iMessage only, no SMS or RCS transport.

## Changes to the screens

These edits to the agreed screens follow from decisions made on 2026-10-20 and from what this change builds:

- Remove "Reply STOP to stop anytime." from the consent line (`phone.fine`, English and Korean). Unlinking happens on the web.
- The `sms` notify channel means an iMessage to the number once sending works again; there is no SMS transport.
- Once connected, the Google start continues to the web chat. The screens offered `/home`, which this app does not have, and said onboarding continues in iMessage, which needs setup over iMessage from a later Phase 6 change.

## Open decisions

1. **Phone accounts (D10).** Settled: a checked number creates the account. Still open: what happens when the Google identity a phone host links already belongs to another host account; and per-source and per-number limits on anonymous starts, so a visitor cannot spend the line's daily allowance texting arbitrary numbers.
2. **Supabase Auth fit.** Supabase phone sign-in sends a 6-digit OTP that the user types into the browser, and its Send SMS hook replaces the built-in sender and receives the OTP ([phone login](https://supabase.com/docs/guides/auth/phone-login), [Send SMS hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)). The agreed flow reverses the direction. Whether a reply-verified number can yield a Supabase session, and whether `linkIdentity()` can add Google to a phone user (manual linking must be enabled; [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)), is unverified and part of the spike.

Shared with the team rather than decided here: the contact address `support@findmeatime.com` that the screens link.

## Capabilities

### New Capabilities

- `host-imessage-linking`: checking that a host controls an iMessage number and binding it to the host, with limits, failure states and unlinking.

### Modified Capabilities

- `chat-workspaces`, `host-admission`, `email-delivery`, `public-agent-entry`: each states Google as the only host sign-in. Their deltas allow a checked iMessage number as a second way to create and enter a host account (D10). They are written after #22 merges, because #22 also changes `host-admission`.

The change also relies on [chat-workspaces](../../specs/chat-workspaces/spec.md) (proof redaction, messaging backpressure), [messaging-environments](../../specs/messaging-environments/spec.md) (no iMessage outside production) and [durable-jobs](../../specs/durable-jobs/spec.md) without changing them.

## Impact

- **Documents:** the files in the differences table and their `ko/` mirrors.
- **Code, after the spike:** the phone and verify screens ported from `apps/web/src/components/thyme/` to `apps/web/app`, the contract moved to `lib/contracts/phone-link.ts`, the connection routes, an outbound text job, a Photon webhook receiver and the reply matcher in `lib/server/`.
- **Schema:** connection, attempt and inbound event tables, generated through pg-delta after Phase 2 (#22) merges, since the shared project already holds its two migrations.
- **Systems:** a Photon project and line, its webhook secret, and a controlled iPhone for the spike and acceptance.
