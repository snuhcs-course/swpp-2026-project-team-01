# Tasks

The change and its implementation land in one pull request. Groups 2, 3 and 4 can be built in parallel against the relay stand-in. Group 5 joins them. Group 6 is the release, which waits for a teammate's approval of the pull request (Q1) and for the relay phone (Q2).

## 1. Decision

- [x] 1.1 Check on a real device that 1:1 and group KakaoTalk notifications carry a **답장** action, and that an invitation raises none. Recorded in the [proposal](proposal.md#why).
- [x] 1.2 Record the proposed decision, marked pending, in the [PRD](../../../documentations/02_product_requirements.md), the [decision log](../../../documentations/technical_specification/08_decision_log.md) and the [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md), and regenerate their Korean mirrors. Verify that `openspec validate host-kakaotalk-channel --strict` and `npm run check` pass.
- [ ] 1.3 Teammate review of Q1 to Q5 and D1 to D8 in the pull request.

## 2. Schema, webhook and outbox (service)

- [x] 2.1 Add `kakaotalk` to the `channel` checks of the four `imessage_*` tables and to `channel_usage_days` and `record_channel_usage_day`. Add the outbox lease columns and the nonce and heartbeat tables ([design 4](design.md#4-records)). Generate the migration with `supabase db schema declarative sync --no-apply`, then verify `supabase db reset --local`, the pgTAP tests, and that existing rows are unchanged.
- [x] 2.2 Add signing, nonce checks and the event parser in `lib/server/kakaotalk.ts`, and the webhook in `agent/channels/kakaotalk.ts` ([design 2](design.md#2-relay-authentication), [design 3](design.md#3-sender-identity)). Unit tests cover each refused signature, nonce replay, rotation, a missing secret, duplicates, a changed payload, group and open-chat events, `void_code`, and the separate hash namespace. Keep the Telegram and Photon receiver tests passing unchanged.
- [x] 2.3 Add the claim, result and heartbeat routes with the claim-time checks, the lease token, the outcome mapping and relay health ([design 5](design.md#5-outbox-and-delivery), [design 7](design.md#7-relay-health)). Tests cover the order per chat, reply versus nudge mode, an ended lease, a late or wrong-token report, `not_started` requeues, a superseded proposal, an ended binding, the relay going down and coming back, a locked phone, and denial outside production.
- [x] 2.4 Add a relay branch to the stand-in, and an integration test that runs a link, a reply and a notice the service starts (nudge, host reply, content), end to end.

## 3. Channel behavior and the web card

- [x] 3.1 Extend `lib/contracts/messaging-channel.ts`, channel selection, the single binding and the link-code binding to four channels. Add the `[KakaoTalk]` transcript prefix, the text-only reply, and the `/app` review link that replaces images on KakaoTalk.
- [x] 3.2 Add **Use KakaoTalk instead** and the KakaoTalk card states to `/app` ([design 6](design.md#6-linking)). A Playwright test covers the card, the copy action and the move to **Linked** against the stand-in.

## 4. Relay app (Android)

- [x] 4.1 Scaffold `apps/kakaotalk-relay/` (Kotlin) with the notification listener, per-message event IDs, the acknowledged-ID ring, group and open-chat filtering and `void_code`. Unit-test the parsing against notification dumps from the device check.
- [x] 4.2 Add request signing, the claim long poll, the reply path through `RemoteInput`, and result reports.
- [ ] 4.3 Add the accessibility path for the nudge. It refuses on zero or several matching chats and confirms that the nudge appears. Test it on the relay phone with the test account only.
- [x] 4.4 Add the heartbeat with the service states, the lock state, the KakaoTalk version and the rooms with a posted notification.
- [ ] 4.5 On the relay phone, check with two 1:1 rooms that a kept reply action for one room never delivers to the other, and capture an open-chat notification to confirm it is not treated as 1:1.

## 5. Documents and join

- [ ] 5.1 Update the privacy policy page, the provider setup (the relay phone, its account, `KAKAOTALK_ACCOUNT_ID` and the two relay secrets with rotation and lost-phone steps), the user journeys and the agent configuration, with Korean mirrors.
- [ ] 5.2 Run `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, the KakaoTalk integration and e2e tests, and `npm run check`.

## 6. Release (after approval)

- [ ] 6.1 Set up the relay phone and the product's KakaoTalk account. Set `KAKAOTALK_ACCOUNT_ID` and the relay secrets on Vercel Production. Merging to `main` then pushes the migration and deploys.
- [ ] 6.2 Run the acceptance flows on production with a teammate's account, and record them in the [acceptance record](../../../documentations/technical_specification/07_acceptance_record.md).
