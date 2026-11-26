# Tasks

This change lands in pull request #501 together with [`host-kakaotalk-channel`](../host-kakaotalk-channel/tasks.md), and its release waits for the same teammate approval (Q1).

## 1. Decision

- [x] 1.1 Check on the Mac mini that `kakaocli` reads the database and sends to a 1:1 chat, and that the Mac `chatId` equals the phone's room ID. Recorded in the [proposal](proposal.md#why).
- [x] 1.2 Update `host-kakaotalk-channel`'s design (rejected options), its D1 row and the [decision log](../../../documentations/technical_specification/08_decision_log.md), and regenerate the Korean mirror.
- [ ] 1.3 Teammate review of D1 to D8 and Q1 to Q3 in the pull request.

## 2. Service

- [x] 2.1 Add `leave_room` to the outbox kind check (KakaoTalk only) and `relay_kind` to the heartbeat row. Generate the migration with pg-delta, verify `supabase db reset --local`, and extend the pgTAP test.
- [x] 2.2 Add `KAKAOTALK_ACTIVE_RELAY`, the `relay` body field and the standby `409` to the webhook, claim and heartbeat routes ([design 1](design.md#1-relays-and-the-active-one)). Accept the log-form event ID, `senderUserId` and `room_members` from the Mac relay ([design 4](design.md#4-events)).
- [x] 2.3 In the claim: no nudge and nothing while locked for the Mac relay, the `leave` mode with `memberRooms` ([design 7](design.md#7-leaving-a-room)), and `queueKakaoTalkLeave`. In the result: the `wrong_room` reason and its alert ([design 5](design.md#5-sending-and-wrong-room-safety)).
- [x] 2.4 Integration tests: standby refusals, a switch of relays, a Mac link and reply, a wrong-room report, leave and its suppressions.

## 3. Mac relay daemon

- [x] 3.1 Scaffold `apps/kakaotalk-mac-relay/` (TypeScript on Node 24): the signer with PROTOCOL.md's known-answer vectors, the database reader with the display-member decoder, and the room rules ([design 3](design.md#3-reading-the-database), [design 5](design.md#5-sending-and-wrong-room-safety), [design 6](design.md#6-no-first-11-message)). Unit tests run against database rows recorded on the Mac mini, with IDs and names replaced.
- [x] 3.2 Add the watcher with its saved per-room marks, the event builder, the webhook queue, the claim loop, the send flow with its three checks, the leave flow and the heartbeat. Unit tests use chat-list fixtures in `kakaocli`'s structure and a fake `kakaocli`; a recorded chat list waits for task 5.3.
- [x] 3.3 Add the Swift helper `kakao-ax` (`supervise`, `probe`, `rows`, `leave`), the LaunchAgent template and the README with setup, grants and the `kakaocli` patch.
- [x] 3.4 Integration test: the daemon's loop against the local routes with the stand-in database, from a code message to the welcome and the reply to the host's turn, each accepted in the right room.

## 4. Documents and checks

- [x] 4.1 Add the Mac relay section to `apps/kakaotalk-relay/PROTOCOL.md` and to the provider setup, with the Korean mirror.
- [x] 4.2 Run `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, the KakaoTalk integration tests and `npm run check`.

## 5. Device (with the user's approval)

- [ ] 5.1 Install the daemon and helper on the Mac mini, grant Accessibility to the helper, and turn off the grant for `sshd-keygen-wrapper`.
- [x] 5.2 End to end on the mini against a local service: an incoming 1:1 message gets an eve reply in the same room. Done on 2026-11-26: the code linked the chat, the welcome and eve's reply were both `accepted` after the landing check, and a message in the group stored nothing.
- [ ] 5.3 With the screen unlocked, record `kakao-ax rows` and the chat window's menu as fixtures, and leave one test group.
- [ ] 5.4 Offer the `kakaocli` fixes upstream (Q3).
