# Tasks

The user said yes to group scheduling on the Mac relay and asked for the simplest flow on 2026-11-26 (see the [proposal](proposal.md#answers-from-the-user-2026-11-26)). `host-kakaotalk-channel`, `host-kakaotalk-mac-relay` and `kakaotalk-group-conversations` are on `main` since #501. Group 1 can start now. Groups 2 to 6 wait for a teammate's review, including proposal Q1, and for agreement with `group-scheduling` (#486) on one poll page.

## 1. Decision

- [ ] 1.1 A teammate reviews D1 to D16, Q1 and the user's answers. Record the outcome in the [PRD](../../../documentations/02_product_requirements.md#outside-the-initial-release) and the [decision log](../../../documentations/technical_specification/08_decision_log.md), and regenerate their Korean mirrors.
- [x] 1.2 Open a tracking issue that names this change, and add its number to the proposal.
- [ ] 1.3 On the Mac mini, check that a bound host's 1:1 room gives their user ID as `directChatMemberUserId`, that the helper can read the newest messages of an opened chat window and leave a group through the window menu, that an untitled group's chat-list label matches the label computed from its member names, and that membership events list a test group's members.
- [ ] 1.4 Agree with the `group-scheduling` change (#486) on one poll page and one group request model.
- [ ] 1.5 Write the deltas for `calendar-booking` (the group confirmation and attendees), `requester-calendar-access` (remembered member grants), `kakaotalk-group-conversations` (the tools and the commands before the model), `host-kakaotalk-mac-relay` (host user ID hashes, member IDs, `/kickout` and the room check) and the PRD functional requirements.

## 2. Hosts, starting and commands (service and relay)

- [ ] 2.1 Add group requests, room bindings, members' answers, remembered member grants and the host user ID hash on KakaoTalk bindings to `supabase/schemas/`, with RLS that denies every client role. Generate the migration with pg-delta and verify `supabase db reset --local` and pgTAP tests for the RLS and the retention rule.
- [ ] 2.2 Store the host's user ID hash from their bound 1:1 room on the Mac relay. Tests cover a code through the Mac relay, a host bound on the phone who writes later on the Mac, and deletion with the binding.
- [ ] 2.3 Handle bare numbers, `<n>번으로 확정`, `stop`, `그만` and an exact `/kickout` before group messages reach the group conversation, and turn on membership events for rooms with open requests. Tests show that a confirmation from any user ID but the organizer's books nothing, that `stop` closes the request whatever the model would answer, and that nothing starts while the phone is active.
- [ ] 2.4 Add `start_group_request`, `group_poll_status`, `group_poll_link` and `record_group_answer` to the group conversation, with the sender from the relay event, and replace the model's reply with the fixed message when a request opens or is refused. Tests cover a linked host, a copied host name, an unlinked caller, a second request in the same room, an answer for someone else, a replayed event, and that the conversation has no booking tool.

## 3. Poll page and answers

- [ ] 3.1 Build `/g/<token>` with Google sign-in that asks for the read-only calendar grant in the same step, ticking by hand as the fallback, an editable display name, **Send me the invitation**, and **Delete my answer** with a device-bound edit token. Playwright tests cover signing in, ticking, editing, deleting and a signed-in busy time removing a candidate.
- [ ] 3.2 Remove signed-in members' busy times from the organizer's candidates, with the most-attendable fallback when none is left, and post the times when the expected number of members have signed in or ticked, when asked, or after 24 hours. Tests show that no member's event detail is stored, logged or passed to the model.
- [ ] 3.3 Recognize returning members by Google account: reuse an existing host's conflict calendars and a past member's remembered grant, with **Don't use my calendar**, **Forget me** and the 180-day deletion. Tests cover each, and that a remembered grant is never read for anything but busy times in an open group.

## 4. Group messages, ranking and booking

- [ ] 4.1 Build the fixed templates for the introduction, the sign-up reply, the candidates, the repeated answers, the confirmation and the goodbye. A test renders every template from a fixture that holds private event titles, notes, emails and busy reasons, and asserts that none appear. An eval asks the group conversation for the organizer's other meetings, members' calendars, private notes and emails, and asserts that no reply contains them.
- [ ] 4.2 Add the ranking, the settle rule and booking by number from the group command, the organizer's chat, `/app` and `host:decide`. Tests cover a stale time, a struck-through time, a repeated confirmation and attendees from the poll page.
- [ ] 4.3 Add closing on booking, cancel and `stop` only, the one-time request for a new date range when every candidate has passed, and the 30-day deletion in the retention pass.

## 5. Private notes, leaving and the room check

- [ ] 5.1 Add private notes, matched to open groups by the sender's user ID hash: model extraction into limits, the read-back, the choice of group, applying limits as busy or less-preferred times, and dropping the text. A test feeds a note and asserts that no group message or organizer view contains it or hints that it exists.
- [ ] 5.2 Add `/kickout` from any group through the Mac relay's `leave_room`, with no automatic leave, and the room check that opens each row with the room's label and acts only in the window that shows the message being answered. Tests with the relay stand-in cover a member's `/kickout`, a room with no request, a booked room that stays, an untitled group, two rooms with the same name, and no matching window.

## 6. Documents and release

- [ ] 6.1 Update the privacy policy for group members without an account, the [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md) and the provider setup, and regenerate the Korean mirrors.
- [ ] 6.2 Run `npm run check`, `npm test`, the integration and e2e suites, and a real-device pass with a test group, then archive the change.
