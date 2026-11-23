# Find Me a Time — User Stories

Status: Draft for team review\
Date: 2026-11-23 (replaces the 2026-10-19 list US-01 to US-32)\
Reference: [Testing baseline](../technical_specification/12_testing_baseline.md)\
Source: [Product requirements](../02_product_requirements.md)\
Companion: [User journeys and flows](01_user_journeys.md)

These are the ten stories of the [testing baseline](../technical_specification/12_testing_baseline.md): nine for hosts, guests and accounts, plus R01 for one account that is both host and guest. The story statements are quoted from the baseline. The baseline owns the step-by-step behavior for each interface and each row's code status; this page states the need, the scope the repository owner decided on 2026-11-23, and where the story stands. A story here does not claim that it is implemented: where the baseline marks a row **differs from code**, **not supported** or **to verify**, that status holds until the row is built and tested.

## Rules for every story

The rules decided on 2026-11-23 are stated once, in the [PRD's core rules](../02_product_requirements.md#4-core-concepts-and-rules) (rules 6 and 7) and its [out-of-scope list](../02_product_requirements.md#outside-the-initial-release): host channel parity, no Thyme chat on the host web, no notice when a request first arrives, and no weekly report. Several of them are still being built (#326–#334), so the stories below say what exists today. WhatsApp stays hidden for now (#221).

## Host

### H01 — Host sign-up and onboarding

As a prospective host, I want to sign up and complete onboarding that sets up my calendar and booking conditions, so that I get a booking link to share.

- Sign in with Google on the web, or start from a messenger (`/?flow=imessage`, `/?flow=telegram`) or from the agent the host already uses (MCP). A host whose setup is incomplete links iMessage or Telegram first and finishes setup in that conversation.
- Decided to build (#328): after the host changes calendars, Thyme proposes new hours from the new analysis; a calendar-note review that fails twice offers a way to skip it and continue.
- Baseline: [H01](../technical_specification/12_testing_baseline.md#h01-host-sign-up-and-onboarding). Whether MCP alone can finish calendar choice is **to verify**.

### H02 — Host booking settings

As a host, I want to view and change my available times and meeting conditions and control whether new requests are accepted, so that I take bookings that fit my situation.

- The web settings dialog changes weekly hours, the weekly meeting limit, one preferred place and whether new requests are accepted; the messenger and MCP change settings in words.
- Decided to build (#328): pausing new requests ("stop taking requests") from iMessage, Telegram and MCP, not only the web; after an MCP change for a set-up host, `nextStep` points to `confirm_setup` so the change does not stay a draft; alternate-week hours, per-week exceptions and a this-week preview.
- Baseline: [H02](../technical_specification/12_testing_baseline.md#h02-host-booking-settings). The rows above are **not supported** or **differ from code** until built.

### H03 — Host review, negotiation and decision

As a host, I want to receive new meeting requests, review them, ask what I need or adjust conditions, and then approve or decline them.

- The host is first told in the messenger once the guest has agreed to a time ("Ready for your approval."), not when the request arrives. The host approves, declines or suggests changed details in the messenger (in words, or with Telegram's buttons), on the web, or through an authorized agent; allowing a weekly-limit or trip exception works today on the web and through MCP only.
- Decided to build (#327): a messenger notice when every candidate time is held back by the weekly limit; messenger tools to waive the weekly limit for one request (`waive_weekly_limit`) and to allow a trip (`allow_host_trip`), as MCP already has; a way for the host to ask the guest a question from the messenger.
- Decided for the web (#326): the host web keeps no Thyme chat, so the request view's **Private messages** chat (still in the code today) is to be removed and conversation about a request happens in the messenger. The web keeps **Request changes**, the rule card (weekly-limit exception, trip estimate) and **Cancel meeting** / **Change meeting**, and the messenger must offer each of them as well.
- Baseline: [H03](../technical_specification/12_testing_baseline.md#h03-host-review-negotiation-and-decision). Rows that these decisions change are being updated by the sessions building them: the preamble and W-2, W-5, W-6 on the host web view, the arrival-notice note, and M-7 (now built rather than refused).

### H04 — Host schedule and meeting status

As a host, I want to see my current schedule, the requests I received and sent, and confirmed bookings, so that I know what is coming and what needs my action.

- The `/app` dashboard calendar shows Google Calendar events, meetings booked through Find Me a Time and requests the host sent to others.
- Decided to build (#330): received requests awaiting a decision on the dashboard calendar; answers to questions about the host's schedule (Google Calendar and booked meetings) in iMessage, Telegram and MCP; a schedule image in the messenger.
- Decided not to build (#330): a weekly report.
- Baseline: [H04](../technical_specification/12_testing_baseline.md#h04-host-schedule-and-meeting-status). Schedule questions and the schedule image are **not supported** until built; the weekly-report row M-6 is to be removed.

## Guest

### G01 — Guest request and time selection

As a guest, I want to request a new meeting with a host, give my conditions, explore feasible times and places, and agree to a suitable proposal.

- The guest needs no account. They start from the host's booking link, from their own agent with that link (MCP), or from a messenger linked on the booking page, and may connect Google Calendar for availability. Every offered time already passes the host's calendar, rules and travel checks; the guest's assistant never explains the host's private reasons.
- Email intake through the host's `@handle` works but is not advertised; whether to offer it remains a separate decision.
- Baseline: [G01](../technical_specification/12_testing_baseline.md#g01-guest-request-and-time-selection).

### G02 — Guest change or withdrawal before booking

As a guest, I want to change or withdraw a meeting request that is not yet booked.

- After agreeing to a time and before the host approves, the guest reopens the agreement with **Change the agreed time** and then changes details, or withdraws.
- Decided to build (#331): the guest's MCP agent gets a `change_agreement` tool that reopens an agreed request exactly like the web's **Change**.
- Baseline: [G02](../technical_specification/12_testing_baseline.md#g02-guest-change-or-withdrawal-before-booking).

### G03 — Guest status, follow-up and result

As a guest, I want to see the progress of my request and the host's responses, continue the conversation when needed, and receive the final booking result.

- Email is the guest's authoritative notice channel; a guest who linked a messenger also gets each outcome there. An MCP agent has no notifications and has to ask.
- Decided to build (#332): after a bounce, the guest can change their email address and get the link again; replies to the confirmation email reach Thyme's conversation instead of going straight to the other participant; the assistant resends the booking link when a guest asks in chat.
- Baseline: [G03](../technical_specification/12_testing_baseline.md#g03-guest-status-follow-up-and-result).

## Both sides

### M01 — Cancel or reschedule a booked meeting

As a participant in a booked meeting, I want to cancel it or change its time, place or other conditions and coordinate again with the other side.

- Either side can cancel or change a booked meeting until it starts. During a change the booked meeting stands; approval updates the same calendar event.
- Decided (#329): the booked guest page keeps its conversation, so a guest who linked no messenger can cancel or start a change in words on the web. Decided (#326): the host web keeps **Cancel meeting** and **Change meeting**; the host's messenger and agent offer both as well.
- Baseline: [M01](../technical_specification/12_testing_baseline.md#m01-cancel-or-reschedule-a-booked-meeting). The guest web conversation after booking is **not supported** until built, and rows W-H1 (host web shows details only) and W-G1, W-G2 are being updated to these decisions.

### A01 — Account and external connections

As a user, I want to manage my account and the connections and permissions of external services, contact channels and personal agents, and leave the service when needed.

- Users link and unlink messengers, connect and revoke agents, and delete their account on the web.
- Decided to build (#333): a host can disconnect Google Calendar on the web and in the messenger, with what happens to setup and open requests spelled out; a guest's STOP in a messenger actually stops messages to them, with a way to start again. Switching to another agent was done in #268.
- Baseline: [A01](../technical_specification/12_testing_baseline.md#a01-account-and-external-connections).

### R01 — One account as host and guest

As a host who also needs meetings with other hosts, I want to book with another host by sending their booking link or @handle in the messenger conversation or the one MCP connection I already use, so that the request runs on the calendar and contact details my host account already has, my host and guest notices arrive in that same place, and each message I send reaches the role it is about.

- Decided to build as written (#334): starting a request from the messenger with a link or `@handle`; identity and host calendars from the account; free text routed by context; guest notices in the same conversation; received and sent requests listed apart; the account MCP `create_request` using the account's name, email and calendars.
- Baseline: [R01](../technical_specification/12_testing_baseline.md#r01-one-account-as-host-and-guest). Most of its messenger and MCP rows **differ from code** or are **not supported** until built.

## Where the earlier stories went

The 2026-10-19 list (US-01 to US-32) is superseded. Its needs are covered as follows, so links from older records still lead somewhere:

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

The selected linking flow shows a one-time link code in the authenticated browser, has the host send it from their own iMessage and links the sender when it arrives, with **Not my number — unlink** on the page; a service-sent six-digit code is the fallback. Implementation and live Google/iPhone acceptance are pending before main-spec promotion.

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

J-08; FR-09; AC-13; PRD section 7. Either side can cancel or change a booked meeting until it starts ([`post-booking-changes`](../../openspec/changes/post-booking-changes/proposal.md), PRD FR-43).

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

As a host, I want to paste `Let me use findmeatime.com for my scheduling`, so that my agent guides sign-in when needed, then required consent and minimal settings, then returns my shareable links without requiring API knowledge.

J-01, J-09; FR-33, FR-35; AC-23, AC-25, AC-26. Interrupted setup resumes without duplicate host creation; optional channel setup can wait.

### US-30 — Start from a host's skill link

As a requester, I want to paste `Let me schedule a meeting with findmeatime.com/dodo`, so that my agent identifies the host, asks only for missing details or decisions, and handles coordination without an account.

J-03; FR-34; AC-24, AC-25. Unsupported capabilities have an actionable setup or web continuation; reading instructions never supplies host approval.

### US-31 — Sign in and start host setup

As a prospective host, I want to sign in with Google and start setup immediately, so that I get an active host account without waiting for approval or connecting my calendar first.

J-01; FR-35; AC-26. Sign-in creates an active host account; a public booking profile still requires completed setup. A suspended host cannot continue hosting operations; requesters do not need accounts to contact active hosts.

### US-32 — Use my Google Calendar availability

As a requester, I want to optionally share my Google Calendar availability, on the same screen as Google sign-in or later, and return to the same request, so that proposed times respect my availability without requiring a Find Me a Time account or becoming a host.

J-02, J-03; FR-36; AC-27. I can instead provide availability manually or through my agent, disconnect calendar access, and recover from consent/read failures. My private event details stay private; connecting a calendar does not agree to a meeting or grant host access.
| Earlier stories | Now in |
|---|---|
| US-01 workspace access, US-18 messenger access, US-25 and US-26 agent connection and revocation, US-27 CLI | A01 (and H01 for first linking) |
| US-02 calendars, US-03 rules, US-04 calendar recovery, US-29 setup through an agent, US-31 sign-in | H01, H02 |
| US-05 request without an account, US-06 clarify details, US-08 delegate by link, US-09 bounded delegation, US-28 account-free agent, US-30 skill link, US-32 guest calendar | G01 |
| US-10 feasible options, US-11 travel time, US-12 no-match cases, US-13 privacy | G01 for the guest, H03 for the host |
| US-14 mobile review, US-15 approve current details, US-16 host agent, US-19 decide in the messenger, US-20 recheck before booking, US-21 no duplicates | H03 |
| US-17 review revisions, US-24 withdraw before booking | G02 |
| US-07 continue across channels, US-22 uncertain outcome, US-23 delivery failures | G03 (and H04 for the host's view) |
| US-24 booked-meeting changes | M01 |
