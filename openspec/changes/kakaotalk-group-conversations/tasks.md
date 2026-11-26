# Tasks

This change lands in pull request #501 with `host-kakaotalk-channel` and `host-kakaotalk-mac-relay`, and waits for the same teammate approval.

## 1. Decision

- [x] 1.1 Record the user's answers (every group, every member, replies only when called) in the proposal.
- [ ] 1.2 Teammate review of D1 to D6 and Q1 to Q3.

## 2. Service

- [x] 2.1 Add `kakaotalk_groups` and `kakaotalk_group_messages`, the `kakaotalk_group` principal, the `group_chat` audience and the `group` admission scope. Generate the migration with pg-delta, reset, and extend pgTAP.
- [x] 2.2 Parse `group_message` events, route group receipts to `lib/server/kakaotalk-groups.ts`, keep context, record calls, and queue replies with no binding.
- [x] 2.3 Extend authorization, principal authority, the bearer and the model limits to the group principal; add `agent/instructions/group-chat.ts`.
- [x] 2.4 Hand group replies only to the Mac relay for rooms in `groupRooms`; cut group replies without an `/app` link.
- [x] 2.5 Unit tests for calls, the input format, settings and the session gate; integration tests for context then a call, a name inside a word, the daily limit, a code, the phone and a group the account left.

## 3. Mac relay

- [x] 3.1 Send `group_message` events with the member's name, list `groupRooms`, and allow sends to them; unit tests against the recorded rows.

## 4. Documents and checks

- [x] 4.1 Update the privacy policy, PROTOCOL.md, the provider setup and the decision log, with Korean mirrors.
- [x] 4.2 Run `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, the KakaoTalk integration tests and `npm run check`.

## 5. Device (with the user's approval)

- [x] 5.1 On the Mac mini, against local eve: a call in 카톡테스트용 is answered in the group. Done on 2026-11-26: the call was forwarded and the reply `accepted` after the landing check. Afterwards the default names became `TimeRabbit` and `타임래빗` only, at the user's request.
