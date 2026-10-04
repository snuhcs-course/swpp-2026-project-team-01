# Find Me a Time — User Stories

Status: Draft for team review\
Date: 2026-10-05\
Source: [Product requirements](../02_product_requirements.md)\
Companion: [User journeys and flows](01_user_journeys.md)

These draft stories are not implementation claims. J IDs reference the companion journeys; FR/AC IDs reference PRD acceptance criteria. PRD decisions remain open; order is not priority.

## Host setup

### US-01 — Access my own workspace

As a host, I want authenticated access limited to my requests, rules, and calendars, so that my scheduling stays private.

J-01; FR-01; AC-10.

### US-02 — Choose calendars

As a host, I want to select Google Calendars for conflicts and booking, so that scheduling reflects my commitments and places meetings correctly.

J-01; FR-02.

### US-03 — Control rules

As a host, I want to inspect and edit availability, timezone, duration, focus time, preferences, and travel buffers, so that the assistant uses rules I understand and control.

J-01; FR-04.

### US-04 — Recover calendar access

As a host, I want a recovery action when calendar access fails, so that unavailable information is not mistaken for free time or a successful booking.

J-01, J-08; FR-03; AC-09.

## Requester intake and delegation

### US-05 — Request without an account

As a requester, I want to provide meeting details through the booking link or email without registering, so that coordination starts easily.

J-02; FR-05, FR-06; AC-01.

### US-06 — Clarify details

As a requester, I want help clarifying dates, timezones, and locations, so that both parties understand the same meeting even across daylight-saving changes.

J-02, J-03; FR-07, FR-15; AC-01, AC-12.

### US-07 — Continue across channels

As a requester, I want verified continuation of my existing request through supported channels, so that I can see current shared details without restarting or gaining access to private history.

J-02, J-03, J-08; FR-08; AC-05, AC-11.

### US-08 — Delegate by link

As a requester, I want to paste `Let me schedule a meeting with findmeatime.com/dodo/SKILL.md` into Dots, Muse, Instinct, ChatGPT, Codex, Claude, or Claude Code, so that my agent handles intake, negotiation, and outcome tracking for me. An ordinary booking link remains supported.

J-03; FR-24, FR-25, FR-29; AC-14, AC-15, AC-22.

### US-09 — Bound delegation

As a requester, I want my agent to agree within my delegated authority and ask about missing details or decisions beyond it, so that coordination progresses within my instructions.

J-03; FR-19, FR-25; AC-15. Requester delegation does not supply host approval.

## Finding suitable options

### US-10 — Receive feasible options

As a host, I want the assistant to rank candidates that satisfy known hard constraints using my explicit preferences, so that recommendations fit my schedule without silently waiving my rules.

J-02, J-03, J-07; FR-11, FR-13; AC-03, AC-07.

### US-11 — Allow travel time

As a host, I want physical meetings checked against estimated travel time plus my required buffers on both sides, so that a free calendar slot does not create an impractical itinerary.

J-02, J-07; FR-12; AC-02.

### US-12 — Resolve no-match cases

As a host, I want a private decision point when no suitable option exists, so that I can revise a preference, explicitly allow an exception, or decline while retaining final approval.

J-07; FR-10, FR-13; AC-03.

### US-13 — Protect privacy

As a host, I want calendar details, preferences, and private discussions separated from requester-facing explanations, so that useful coordination does not disclose my private information to requesters.

J-04, J-05, J-06, J-07; FR-14; AC-03, AC-10; PRD section 8.

## Host review and agreement

### US-14 — Review on mobile

As a host, I want an accessible, phone-friendly view of the complete current proposal and exceptions, so that I can approve, revise, or decline confidently.

J-04; FR-16; AC-01; PRD section 8.

### US-15 — Approve current details

As a host, I want my explicit approval tied to the current proposal and recorded in its history, so that stale replies or later edits cannot authorize an unintended meeting.

J-04, J-05, J-06; FR-17; AC-04, AC-05; PRD section 8.

### US-16 — Use my agent

As a host, I want Dots, Muse, Instinct, ChatGPT, Codex, Claude, or Claude Code to relay my explicit decision on the exact proposal, with confirmation fallback, so that my agent helps without deciding consent.

J-05; FR-18, FR-24; AC-10, AC-14.

### US-17 — Review revisions

As a requester, I want to suggest alternatives and review changed meeting details, so that both parties agree on the current proposal.

J-07; FR-09, FR-17, FR-19; AC-04.

### US-18 — Control iMessage access

As a host, I want to opt into a verified private iMessage conversation and unlink it later, so that only my linked identity receives private summaries and can act for me.

J-01, J-06; FR-26; AC-17.

### US-19 — Decide through iMessage

As a host, I want to discuss, revise, approve, or decline the current proposal through iMessage, with clarification or authenticated web review when needed, so that conversation preserves explicit, unambiguous decisions.

J-06; FR-27; AC-16, AC-17.

## Booking and recovery

### US-20 — Recheck before booking

As a host, I want current agreement, approval, and feasibility rechecked before event creation, so that newly detected conflicts or changed rules stop an invalid booking.

J-04, J-07, J-08; FR-20; AC-07.

### US-21 — Avoid duplicate bookings

As a host, I want repeated messages and simultaneous channel actions to produce one consistent outcome, so that retries or service restarts do not create duplicate events.

J-06, J-08; FR-21, FR-28; AC-06, AC-18.

### US-22 — Understand uncertainty

As a requester, I want an uncertain calendar-write outcome shown as pending until resolved, so that I do not mistake a timeout for either confirmation or a safely failed booking.

J-08; FR-22; AC-08.

### US-23 — Distinguish delivery failures

As a host, I want confirmed event details or a truthful failure and recovery action, so that I can continue on web and distinguish a booking problem from an undelivered notification.

J-06, J-08; FR-23, FR-28; AC-09, AC-18.

### US-24 — Withdraw or close

As a requester, I want to withdraw before booking and see accurate pending or closed status, so that late replies cannot silently revive a withdrawn, declined, or expired request.

J-08; FR-09; AC-13; PRD section 7. Automated post-booking rescheduling and cancellation remain outside initial scope.

## Agent connection and permissions

### US-25 — Connect through OAuth

As a host, I want to sign in and review the permissions requested by my MCP client before consenting, so that I understand which Find Me a Time operations it can perform for me.

J-09; FR-29, FR-31; AC-19, AC-20. Connecting a client does not approve meetings or share Google Calendar credentials with it.

### US-26 — Revoke agent access

As a host, I want to inspect and revoke connected agent clients, so that I can stop their protected access while continuing to manage requests on web.

J-09; FR-31; AC-19.

### US-27 — Use a CLI with my terminal-based agent

As a user of a terminal-based agent, I want a CLI with structured JSON results and the same role-appropriate scheduling operations as MCP, so that my agent can coordinate requests without inconsistent state or broader permissions.

J-03, J-05, J-09; FR-29, FR-30; AC-22.

### US-28 — Keep requester access account-free

As a requester, I want my agent to submit and continue my request without a Find Me a Time account or host OAuth grant, so that delegation remains convenient while access stays limited to my request.

J-03; FR-32; AC-21. Missing integration setup should produce a clear next step or web continuation, not a claim that a connection already exists.

## Starting with a pasted prompt

### US-29 — Set up scheduling through my agent

As a host, I want to paste `Let me use findmeatime.com/SKILL.md for my scheduling`, so that my agent guides waitlist entry or invitation redemption when needed, then sign-in, required consent, and minimal settings, then returns my shareable links without requiring API knowledge.

J-01, J-09; FR-33, FR-35; AC-23, AC-25, AC-26. Interrupted setup resumes without duplicate host creation; optional channel setup can wait.

### US-30 — Start from a host's skill link

As a requester, I want to paste `Let me schedule a meeting with findmeatime.com/dodo/SKILL.md`, so that my agent identifies the host, asks only for missing details or decisions, and handles coordination without an account.

J-03; FR-34; AC-24, AC-25. Unsupported capabilities have an actionable setup or web continuation; reading instructions never supplies host approval.

### US-31 — Join the waitlist and activate invited access

As a prospective host, I want to join the waitlist and resume setup when invited, so that I understand my access status without connecting my calendar before admission.

J-01; FR-35; AC-26. Waitlist confirmation is not host activation. Invalid or reused invitations cannot grant access to another account; requesters do not need invitations to contact active hosts.

### US-32 — Use my Google Calendar availability

As a requester, I want to optionally connect Google Calendar and return to the same request, so that proposed times respect my availability without requiring a Find Me a Time account or host invitation.

J-02, J-03; FR-36; AC-27. I can instead provide availability manually or through my agent, disconnect calendar access, and recover from consent/read failures. My private event details stay private; connecting a calendar does not agree to a meeting or grant host access.
