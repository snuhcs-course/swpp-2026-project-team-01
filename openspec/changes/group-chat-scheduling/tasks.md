# Tasks

This change is a draft. Only group 1 can start now. Groups 2 to 6 wait for a team yes on Q1 and Q2 in the [proposal](proposal.md#unresolved-decisions-for-the-team), and for `host-kakaotalk-channel` and `host-kakaotalk-mac-relay` to be merged.

## 1. Decision

- [ ] 1.1 Team discussion of the open questions and D1 to D8. Record the outcome in the [PRD](../../../documentations/02_product_requirements.md#outside-the-initial-release) and the [decision log](../../../documentations/technical_specification/08_decision_log.md), and regenerate their Korean mirrors.
- [ ] 1.2 If the team says yes, open a tracking issue that names this change, and add its number to the proposal.
- [ ] 1.3 On the Mac mini, check that the helper can read the newest messages of an opened chat window and leave a group through the window menu (Q13), that an untitled group's chat-list label matches the label computed from its member names, and that membership events list a test group's members.
- [ ] 1.4 Write the deltas for `calendar-booking` (attendees), `host-kakaotalk-channel` and `host-kakaotalk-mac-relay` (group text for activated rooms, `/kickout` from any group, member IDs and the room check) and the PRD functional requirements.

## 2. Activation and parsing (service and relay)

- [ ] 2.1 Add group codes, group requests, room bindings and members' answers to `supabase/schemas/`, with RLS that denies every client role. Generate the migration with pg-delta and verify `supabase db reset --local` and pgTAP tests for the RLS and the retention rule.
- [ ] 2.2 Add code issuance in `/app` and the organizer's chat, and binding on arrival in a group. Unit tests cover each refused code: in a 1:1 chat, a host code in a group, expired, used, a second code for an open room, and the rate limit.
- [ ] 2.3 Change the Mac relay to forward codes and an exact `/kickout` from any group, all messages with text only from active rooms, using the heartbeat's room list, and membership events for active rooms. Refuse group codes while the phone is the active relay. Test that an inactive room forwards nothing else.
- [ ] 2.4 Add the fixed parser for numbers, `none`, `stop`, `/kickout` and codes, keyed by the sender's user ID. Tests show that unmatched text never reaches the model or storage, and that a replayed event is counted once.

## 3. Poll page and answers

- [ ] 3.1 Build `/g/<token>` with a display name, a read-only Google Calendar connection bound to the group request as the first step, ticking by hand as the fallback, an optional email with **Send me the invitation**, and **Delete my answer** with a device-bound edit token. Playwright tests cover connecting, ticking, editing, deleting and a connected busy time removing a candidate.
- [ ] 3.2 Remove connected members' busy times from the organizer's candidates, with the most-attendable fallback when none is left, and post the times when the expected number of members have connected or ticked, when the organizer asks, or after 24 hours. Keep chat answers and page answers separate by name, with no unverified label. Tests show that no member's event detail is stored, logged or passed to the model.
- [ ] 3.3 Recognize members by Google sign-in: reuse an existing host's conflict calendars and a past member's remembered grant, with **Don't use my calendar**, **Forget me** and the 180-day deletion. Tests cover each, and that a remembered grant is never read for anything but busy times in an open group.

## 4. Group messages, ranking and booking

- [ ] 4.1 Build the fixed templates for the introduction, the candidates, the counts and the confirmation. A test renders every template from a fixture that holds private event titles, notes, emails and busy reasons, and asserts that none appear.
- [ ] 4.2 Add the ranking, the settle rule and booking by number from the organizer's chat, `/app` and `host:decide`. Tests cover a group message that tries to book, a stale time, a repeated booking and attendees from emails.
- [ ] 4.3 Add closing on booking, cancel and `stop` only, the one-time request for a new date range when every candidate has passed, and the 30-day deletion in the retention pass.

## 5. Member identity, private notes and leaving

- [ ] 5.1 Add the member identity hash from the Mac relay's user ID, the room member hashes, and the `FMAT-M` member code sent in the group or a 1:1 chat. Tests cover a code tie, a copied profile name, a 1:1 sender in no group, deletion on **Forget me** and after 180 days.
- [ ] 5.2 Add the reuse question in the group, addressed to the member by name, once per member per group, with yes, no and forget-me. Tests show that only the same user ID's answer counts, that only "yes" reuses a connection, and that the account never starts a 1:1 chat.
- [ ] 5.3 Add private notes, matched to groups by the sender's user ID: model extraction into limits, the read-back, the choice of group, applying limits as busy or less-preferred times, and dropping the text. A test feeds a note and asserts that no group message or organizer view contains it or hints that it exists.
- [ ] 5.4 Add `/kickout` from any group through the Mac relay's `leave_room`, with no automatic leave, and the room check that opens each row with the room's label and acts only in the window that shows the message being answered. Tests with the relay stand-in cover a member's `/kickout`, a room never activated, a booked room that stays, an untitled group, two rooms with the same name, and no matching window.

## 6. Documents and release

- [ ] 6.1 Update the privacy policy for group members without an account, the [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md) and the provider setup, and regenerate the Korean mirrors.
- [ ] 6.2 Run `npm run check`, `npm test`, the integration and e2e suites, and a real-device pass with a test group, then archive the change.
