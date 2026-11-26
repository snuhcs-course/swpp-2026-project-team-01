# Tasks

## 1. Schema

- [x] 1.1 Add `group_meetings`, `requests.group_meeting_id` and the participant's confirmed intervals with their places, usual place and travel mode, with the shared link stored by hash. Exempt open groups' participant requests and booking links from expiry. Generate the migration and verify `supabase db reset --local` and pgTAP tests for the RLS and the link hash.

## 2. Host chat

- [ ] 2.1 Add host chat tools to create and close a group, allowed only on a linked messenger turn. Verify integration tests for a created group, a missing term, a web turn and an early close with and without done participants.
- [x] 2.2 Leave participant requests out of the host's request lists, counts, dashboard and notices, and add a host chat tool for the group's progress. Verify integration tests for a done participant missing from the list and a progress answer.
- [x] 2.3 Update `agent/instructions/host-imessage.ts` for the group requests.

## 3. Participant flow

- [ ] 3.1 Open the shared link into a participant request, continue a returning person's request, and show a closed link. Verify integration tests for full, closed and repeated opens.
- [ ] 3.2 Require Calendar on participant requests and refuse term changes in the guest tools. Verify integration tests for an unchecked Calendar scope and a length change.
- [ ] 3.3 Add the one question, stored commitments (preferred hours only when volunteered), and the review of unavailable times. Verify unit tests that no event title or attendee is stored, and integration tests for a correction, a confirmation and a change after done.
- [x] 3.4 Update `agent/instructions/requester.ts` for the participant step order.

## 4. Close and choice

- [x] 4.1 Compute options over the host and every participant with `lib/server/feasibility.ts`, using the confirmed intervals and places without reading participant calendars: time-and-place pairs with everyone's travel legs, the place tiers, online options and the most-fitting fallback. Verify unit tests for the scenarios of "Host told when the group closes".
- [x] 4.2 Find points between participants' places with Google Geocoding and Places. Verify unit tests with a stubbed lookup and a failed lookup.
- [ ] 4.3 Send the host's close notice and answer requests for more times. Verify integration tests through the messenger stand-in.
- [ ] 4.4 Book the chosen option as one event at its place or with Google Meet, with every participant as an attendee, rechecking only the host's calendars, and close the participant requests. Verify integration tests for a fitting time, a time one participant cannot make, a host-busy time and a repeated choice.

## 5. Documents

- [x] 5.1 Add the group stories to `documentations/user_experience/02_user_stories.md`, a group flow page under `documentations/user_experience/`, and the feature to `documentations/02_product_requirements.md`.

## 6. Release

- [ ] 6.1 Teammate review.
