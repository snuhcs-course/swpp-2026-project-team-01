# Product decisions to review

A checklist for reviewing the product decisions behind Phase 3 (`requester-intake-and-feasibility`). It does not replace the [proposal](proposal.md#decisions) or the [design](design.md). Those remain authoritative, and any change to a decision goes there and into the delta specs first. Tick a box once the team has agreed to keep the decision as it is.

Two groups:

1. **D1–D12**: decided by Dohyeon Park on 2026-10-21, before teammate review.
2. **Implementation choices**: made by the implementing agents and the security fixes, and recorded in the design. Nobody has explicitly decided them.

## 1. Decided before teammate review

- [ ] **D1. Travel routes and adjacency** ([design 9](design.md#9-travel-legs-and-google-routes)).
  - **Chosen:** no country list. Each leg is checked against the nearest commitment on the same local day, whatever the gap. A candidate in an overnight window belongs to the window's starting day. Route estimates are reused for 24 hours.
  - **Rejected:** a country allowlist; a 3-hour adjacency horizon.
  - **Consequence:** a meeting at 09:00 makes a 16:00 in-person candidate depend on a route from that morning's location. More legs come out unresolved.
  - **Check:** whether driving and walking routes exist in South Korea (task 5.2, not run yet). If they don't, every Korean host who drives or walks sees unresolved legs until Phase 4's allowance control ships.

- [ ] **D2. Manual travel allowance** ([design 10](design.md#10-manual-travel-allowances)).
  - **Chosen:** an allowance covers one leg of one candidate, 5–240 minutes in 5-minute steps.
  - **Rejected:** one allowance per request and pair of places; a standing host rule.
  - **Consequence:** the host confirms each leg separately, so the same trip appears again for every candidate.
  - **Also in this change:** requesters set allowances for their own legs on the candidate card. That extends D2, which was framed as host-only.

- [ ] **D3. Optional contact confirmation**, replacing the six-digit codes ([design 6](design.md#6-contact-confirmation)).
  - **Chosen:** the creation email carries the booking link and a confirmation link. Nothing waits on confirmation. Resend goes only to a confirmed address. Sends are limited to one per 60 seconds, 5 per request and 10 per address per hour, and 1,000 per day service-wide.
  - **Accepted trade-off:** a mistyped address receives the booking link, and with it access to the request.
  - **Changed by the security fixes:**
    - The limits now count every creation email, including those sent on a contact change. A contact change past a limit is refused.
    - Confirmation requires pressing a button on the page, so a mail scanner opening the link does not confirm.
  - **Check:** whether the host should see more than "confirmed / unconfirmed" before approving in Phase 4.

- [ ] **D4. Cloudflare email** ([design 5](design.md#5-cloudflare-email-adapter)).
  - **Chosen:** the REST API with an `Email Sending: Edit` token. Delivery evidence is recipient acceptance plus our own dispatch ID.
  - **Needs:** the Workers Paid plan.
  - **Check:** whether a live REST response carries a message ID; if it does, store it as well.

- [ ] **D5. Evaluation runs as an application job** ([design 8](design.md#8-evaluation-runs-as-an-application-job)).
  - **Chosen:** the tool publishes the job and waits up to 20 seconds. The **Find times** card runs the same job.

- [ ] **D6. Online meeting link** ([design 11](design.md#11-online-meeting-link-plan)).
  - **Chosen:** a Google Meet conference created with the event when the host's booking calendar allows Meet, otherwise a link the requester supplies. With neither, no proposal is created.
  - **Check:** the Phase 4 proposal must create the conference with the event.

- [ ] **D7. Request creation limits** ([design 2](design.md#2-one-guest-thread-from-the-first-message)).
  - **Chosen:** 5 per source address per hour, 20 per day, and 500 per day service-wide. There is **no per-host cap**.
  - **Consequence:** a popular or targeted host can receive many requests; only the per-source and service limits apply.

- [ ] **D8. Requester Google consent** ([design 3](design.md#3-requester-google-consent)).
  - **Chosen:** `calendar.calendarlist.readonly` and `calendar.events.readonly` on the host sign-in OAuth client, reused by default (`GOOGLE_REQUESTER_CLIENT_ID`/`GOOGLE_REQUESTER_CLIENT_SECRET` may name a separate one). The button is always shown.
  - **Delete-only grants:** closure, link expiry and **Disconnect** delete the stored token; the service never calls Google's revocation endpoint, so a requester's closure never touches the same person's host Calendar grant. Google expires the unused grant itself, and it may stay listed in the requester's Google third-party access until then. Decided by Dohyeon Park on 2026-10-22, replacing a separate requester client with revocation at Google.
  - **Use of event details:** host-style busy rules, and the requester's own travel legs. They are never stored, logged, given to the model, or shown to the host or any agent.
  - **Changed:** PRD FR-12 and §5, which said requester access was availability-only.
  - **Consequences:**
    - Google's verification for this scope is broader.
    - Until the Google app is published, unlisted users reach Google's error page.
  - **Check:** the consent wording, and whether the privacy disclosures need updating before launch.

- [ ] **D9. Local messaging** ([design 13](design.md#13-local-messaging)).
  - **Chosen:** local runs send only to a stand-in on loopback.

- [ ] **D10. Booking link storage** ([design 7](design.md#7-link-resend)).
  - **Chosen:** look up by hash, plus a sealed copy, so the current link can be emailed and resent.
  - **Consequence:** a database dump together with `TOKEN_ENCRYPTION_KEY` yields live links.

- [ ] **D11. Assistant conversation on `/{handle}`**, revised by D13 ([design 2](design.md#2-one-guest-thread-from-the-first-message)).
  - **Chosen first:** a separate anonymous intake. Replaced on 2026-10-22 by a draft request in the same thread.

- [ ] **D12. Verification before agreement.** Withdrawn by D3. An unconfirmed address can agree.

- [ ] **D13. Continuous, chat-native guest thread** ([design 2](design.md#2-one-guest-thread-from-the-first-message)).
  - **Chosen:** the first message creates a draft request, hidden from the host and deleted after 24 hours if the guest never identifies. One assistant session runs from that message to agreement, every card sits inside the thread, and the address bar changes to the booking link in place on identification.
  - **Rejected:** stitching a separate intake session to the request.
  - **Consequences:** abandoned conversations create short-lived draft rows; candidates wait until the guest gives a name and email.

## 2. Implementation choices not yet decided by anyone

- [ ] **Unconfirmed requests count as anonymous spend.** A request with no confirmed address and no Google identity gets USD 3 of model allowance per day and counts toward the USD 50 anonymous pool. It gets the normal USD 30 once the address is confirmed. This came from the security review (design 2). Check that confirmation stays optional in practice: does a requester who never confirms run out mid-conversation?
- [ ] **Evaluation limits.** A running evaluation at the same revisions is reused, and a request starts at most 10 evaluations an hour (design 8). Travel is checked for at most 40 candidates, and the model ranks only the first 20.
- [ ] **Choosing a time does not advance the request revision.** The proposal version is what agreement names (design 12). The automatic move from gathering to negotiating also does not advance it (design 4).
- [ ] **Details are locked while awaiting host approval.** Once a requester has agreed, they cannot change details until the host acts.
- [ ] **Requester travel mode.** In-person requests ask for **Driving**, **Public transit** or **Walking** on the details card. Requester legs use no buffer.
- [ ] **Allowance control without a known place.** The "Allow N minutes for my trip" control is shown even when the earlier event has no location, and then cannot be used. Decide whether to hide it.
- [ ] **The weekly limit only orders candidates.** When every candidate falls in a week at the limit, they are still offered. The host's waiver control arrives in Phase 4, and the main spec "Only full weeks" says no candidate should be offered until then.
- [ ] **A different Google address is only recorded.** When the Google address differs from the typed contact, nothing yet offers to switch to it.
- [ ] **Redaction thresholds.**
  - Bearer values are removed only when at least 8 characters long with a digit or punctuation, so an all-letter token gets through.
  - Bare UUIDs are removed from requester and intake input, but not from host input.
- [ ] **Cloudflare 429 counts as rejected,** not uncertain. The requester can send again after the cooldown.
- [ ] **Eval-only auth entry.** `createEvalRequesterAuth` in `lib/server/eve-auth.ts` lets `eve eval` run requester evals locally. It is active only with `FMAT_EVAL_AUDIENCE=requester`, outside Vercel, inside `eve dev`. It needs a reviewer's look because it touches authentication.
- [ ] **Ranking model.** Ranking uses `gpt-5.6-terra` through the existing model limits. Live ranking quality has not been tested.
