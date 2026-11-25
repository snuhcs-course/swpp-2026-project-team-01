# Tasks

This change is a draft. Only group 1 can start now. Groups 2 to 5 wait for a team yes on Q1 and Q2 in the [proposal](proposal.md#unresolved-decisions-for-the-team), and for `host-kakaotalk-channel` to be merged.

## 1. Decision

- [ ] 1.1 Team discussion of the open questions and D1 to D8. Record the outcome in the [PRD](../../../documentations/02_product_requirements.md#outside-the-initial-release) and the [decision log](../../../documentations/technical_specification/08_decision_log.md), and regenerate their Korean mirrors.
- [ ] 1.2 If the team says yes, open a tracking issue that names this change, and add its number to the proposal.
- [ ] 1.3 On a real device, check that KakaoTalk posts one notification per group message when several arrive together, that a two-person group can be told apart from a 1:1 chat, and whether a group notification's `Person.key` is stable per member (Q9).
- [ ] 1.4 Write the deltas for `calendar-booking` (attendees), `host-kakaotalk-channel` (forwarding for activated rooms) and the PRD functional requirements.

## 2. Activation and parsing (service and relay)

- [ ] 2.1 Add group codes, group requests, room bindings and members' answers to `supabase/schemas/`, with RLS that denies every client role. Generate the migration with pg-delta and verify `supabase db reset --local` and pgTAP tests for the RLS and the retention rule.
- [ ] 2.2 Add code issuance in `/app` and the organizer's chat, and binding on arrival in a group. Unit tests cover each refused code: in a 1:1 chat, a host code in a group, expired, used, a second code for an open room, and the rate limit.
- [ ] 2.3 Change the relay app to forward group-code messages from any room, and all messages only from active rooms, using the heartbeat's room list. Test that an inactive room forwards nothing else.
- [ ] 2.4 Add the fixed parser for numbers, `none`, `stop` and codes. Tests show that unmatched text never reaches the model or storage, and that a replayed event is counted once.

## 3. Poll page and answers

- [ ] 3.1 Build `/g/<token>` with a display name, a read-only Google Calendar connection bound to the group request as the first step, ticking by hand as the fallback, an optional email with **Send me the invitation**, and **Delete my answer** with a device-bound edit token. Playwright tests cover connecting, ticking, editing, deleting and a connected busy time removing a candidate.
- [ ] 3.2 Remove connected members' busy times from the organizer's candidates, with the most-attendable fallback when none is left, and post the times when the organizer asks or after 24 hours. Keep chat answers and page answers separate by name, with no unverified label. Tests show that no member's event detail is stored, logged or passed to the model.
- [ ] 3.3 Recognize members by Google sign-in: reuse an existing host's conflict calendars and a past member's remembered grant, with **Don't use my calendar**, **Forget me** and the 180-day deletion. Tests cover each, and that a remembered grant is never read for anything but busy times in an open group.

## 4. Group messages, ranking and booking

- [ ] 4.1 Build the fixed templates for the introduction, the candidates, the counts and the confirmation. A test renders every template from a fixture that holds private event titles, notes, emails and busy reasons, and asserts that none appear.
- [ ] 4.2 Add the ranking, the settle rule and booking by number from the organizer's chat, `/app` and `host:decide`. Tests cover a group message that tries to book, a stale time, a repeated booking and attendees from emails.
- [ ] 4.3 Add closing on booking, cancel, `stop` and 14 days, and the 30-day deletion in the retention pass.

## 5. Documents and release

- [ ] 5.1 Update the privacy policy for group members without an account, the [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md) and the provider setup, and regenerate the Korean mirrors.
- [ ] 5.2 Run `npm run check`, `npm test`, the integration and e2e suites, and a real-device pass with a test group, then archive the change.
