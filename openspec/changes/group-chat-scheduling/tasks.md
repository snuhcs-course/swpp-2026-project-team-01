# Tasks

The user said yes to group scheduling from KakaoTalk groups on the Mac relay, and asked for the simplest flow, on 2026-11-26 (see the [proposal](proposal.md#answers-from-the-user-2026-11-26)). The KakaoTalk changes are on `main` since #501. This change builds on `group-scheduling` (PR #504). Group 1 can start now. Groups 2 to 5 wait for a teammate's review (Q1), enu3379's agreement (Q2) and #504 merged.

## 1. Decision

- [ ] 1.1 A teammate reviews D1 to D16, Q1 and Q3, and enu3379 answers Q2. Record the outcome in the [PRD](../../../documentations/02_product_requirements.md#outside-the-initial-release) and the [decision log](../../../documentations/technical_specification/08_decision_log.md), and regenerate their Korean mirrors.
- [x] 1.2 Open a tracking issue that names this change, and add its number to the proposal.
- [ ] 1.3 On the Mac mini, check that a bound host's 1:1 room gives their user ID as `directChatMemberUserId`, that the helper can read the newest messages of an opened chat window and leave a group through the window menu, and that an untitled group's chat-list label matches the label computed from its member names.
- [ ] 1.4 After `group-scheduling` is archived, write the deltas for `group-scheduling` (creation from a room, an organizer with no account, the two-tap flow, painting, options and choice in the room), `calendar-booking` (the room confirmation), `calendar-booking` (events owned by the service's scheduling calendar), `kakaotalk-group-conversations` (the tools and the commands before the model), `host-kakaotalk-mac-relay` (host user ID hashes, `/kickout` and the room check) and the PRD functional requirements.

## 2. Hosts and the room binding

- [ ] 2.1 Add the room binding of a group meeting, the organizer ID hash, painted answers, and the host user ID hash on KakaoTalk bindings to `supabase/schemas/`, with RLS that denies every client role. Generate the migration with pg-delta and verify `supabase db reset --local` and pgTAP tests for the RLS, one live binding per room and the 30-day deletion.
- [ ] 2.2 Store the host's user ID hash from their bound 1:1 room on the Mac relay. Tests cover a code through the Mac relay, a host bound on the phone who writes later on the Mac, and deletion with the binding.

- [ ] 2.3 Add the room meeting's flow to `group-scheduling`'s link: the two-tap Google path with the pre-filled grid, painting without Google, changing an answer until the close, the done count on the page, and booking into the service's scheduling calendar for an organizer with no account. Playwright tests cover two taps to done, a returning member, a painted answer, a painted answer changed from another device (refused), and that the page never shows who is done. Add the service calendar's Google account to the provider setup.

## 3. The group conversation

- [ ] 3.1 Handle `<n>번으로 확정`, `stop`, `그만` and an exact `/kickout` before group messages reach the group conversation. Tests show that a confirmation from any user ID but the organizer's books nothing, that `stop` ends the binding, leaves a linked host's meeting open and cancels one whose organizer has no account, whatever the model would answer, and that nothing starts while the phone is active.
- [ ] 3.2 Add `start_group_meeting`, `group_meeting_status`, `group_meeting_link` and `close_group_meeting`, with the sender from the relay event, creating meetings through `group-scheduling`'s own creation path, and replace the model's reply with the fixed message when a meeting is created or refused. Tests cover a linked host, a copied host name, a caller with no account, a caller at the three-meeting limit, a missing date range, a second meeting in the same room, an early close from someone else, and that the conversation has no booking tool.

## 4. Posts to the room

- [ ] 4.1 Build the fixed templates for the introduction, the done-count line, the options, the confirmation and the goodbye, and post the options when a bound meeting closes and when the organizer asks for more. A test renders every template from a fixture that holds participants' names, events, places and emails, and asserts that none appear. An eval asks the group conversation who cannot make an option, who is done and the organizer's other meetings, and asserts that no reply contains them.
- [ ] 4.2 Book from the room command through `group-scheduling`'s host choice. Tests cover a confirmation before the close, a stale option, a repeated confirmation, and the room confirmation ending the binding.

## 5. Leaving and the room check

- [ ] 5.1 Add `/kickout` from any group through the Mac relay's `leave_room`, with no automatic leave, and the room check that opens each row with the room's label and acts only in the window that shows the message being answered. Tests with the relay stand-in cover a member's `/kickout`, a room with no binding, a booked room that stays, an untitled group, two rooms with the same name, and no matching window.
- [ ] 5.2 Update the privacy policy, `documentations/user_experience/07_group_meeting_flow.md`, the [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md) and the provider setup, and regenerate the Korean mirrors.
- [ ] 5.3 Run `npm run check`, `npm test`, the integration and e2e suites, and a real-device pass with a test group, then archive the change.
