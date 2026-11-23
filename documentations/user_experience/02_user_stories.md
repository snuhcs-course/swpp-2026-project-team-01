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
