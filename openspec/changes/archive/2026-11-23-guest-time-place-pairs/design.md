# Design

## Context

See [proposal.md](proposal.md). The feasibility engine (`lib/server/feasibility.ts`) is pure: the evaluation job (`lib/server/evaluation.ts`) reads calendars and route estimates and passes them in. Today `RequestTerms.location` is the one meeting place, taken from the request's details; with it null an in-person candidate's legs are unresolved (`meeting_location_unknown`), and its `location` is null. The host's confirmed location answer (`ConfirmedSettings.location`) is either `places` (up to five areas and an optional venue) or `decide_per_meeting`; `read_request` already gives it to the guest's assistant as `host.offer.places`. A chosen candidate's place is copied into the proposal's details, and the booking writes the proposal's place to the event.

## Decisions

### 1. Which places make pairs

Pairs are made only when the meeting resolves to in person, the request names no place, and the host's answer is `places`. The places are the venue first, then the areas in the host's order, without repeats, at most six. With a requested place (the guest's own or one the host shared in a change), the request has exactly that place, as today. With `decide_per_meeting`, no answer, or an online meeting, nothing changes. Whether the meeting is in person is still decided as today: a host who offers either form and a guest who named neither form nor place still gets an online meeting.

Rejected: pairs for a guest-named place and the host's places together | the guest asked for that place, and mixing them would offer places the guest just declined. Rejected: the preferred area from calendar analysis | observed place evidence stays host-private; only the host's confirmed answer is offered.

### 2. Pairs in the engine

`RequestTerms.places` carries the host's places, keyed like event places. In `plan()`, the free times (after the host-busy and requester-busy checks) are paired with each place, so a time is checked once against busy time and then once per place for travel. Each pair's legs use its own place as the meeting endpoint, so travel, buffers, the same-place rule, allowances (which name both endpoints) and the requester's legs apply per pair unchanged.

Order: the existing keys (weekly limit, trip rank, the guest's preferences, the day spread), then start, then the host's place order. Pairs of one time stay together, so the 40-candidate cut keeps whole times. The cut counts pairs, so an evaluation estimates at most as many legs as before; with six places it checks about seven distinct times instead of forty, and **Find other times** searches again for later ones. The same-day trip rank needs one meeting place, so it does not apply to pairs (no place is far from itself among the host's own places, and the rank's preferred area is one of them).

Rejected: checking every place for each of the forty times | up to six times the Routes calls under the same 18-second deadline. Rejected: place-major order (every time at the venue, then every time at the first area) | the cut would keep only the first place.

### 3. Pair identity

A pair's candidate ID is the time's ID with the place's index, `c<start>-<minutes>-p<index>`; a time with one requested place keeps its existing ID. IDs live only within their evaluation (`choose_candidate`, `allow_trip` and the host's allowance controls look them up there), so an index is enough. Each pair carries its place as `location`, which the requester projection, the times card and the assistant already show.

### 4. What the guest sees first

The requester projection lists each time's first offered pair before any time's second, keeping the engine's order otherwise. The first three cards are then three different times, each at the first of the host's places that works for it; the same times at other places follow in **Find other times**, and the assistant has them in `laterCandidates` to answer "can we meet at the station instead?". With one place per time the order is unchanged.

### 5. Another area

A guest who asks to meet elsewhere gives a place; the assistant drafts it as the request's place with the existing review card, and applying it starts an ordinary evaluation with that one place. The candidates are pairs at that place only. When the evaluation completes with nothing offered and the request names a place that is not one of the host's places, the no-match message says no time works there yet and suggests another area, other days or one of the host's places; like every requester message it carries no reason. Host-unresolved pairs stay host-private as today, so the guest never learns that a trip could not be estimated.

The assistant still describes the host's places as their meeting options and never says an unlisted place has been approved: the host sees the place in the proposal and approves or declines it.

### 6. Limits

The proposal's question: the existing limit covers alternate-area requests. Applying a new place changes the request's details and starts one evaluation through the same path as any other change, counted by the limit of 10 new evaluations per request in any rolling hour, and reused while one for the same revisions is running. One evaluation's Routes work is bounded by the 40-pair cut and the shared deadline (decision 2). No separate limit is added.

### 7. The chosen place is the checked place

`EvaluateOptions.place` pins a fixed-interval check to one place. Agreement's calendar recheck passes the latest proposal's place, and booking revalidation passes the booked proposal's place, so they check exactly the pair the guest chose rather than every host place at that time. A shared change already writes its place into the request's details. The proposal, the host's approval card and the booked event all read the proposal's place, which `choose_candidate` copies from the pair unchanged.
