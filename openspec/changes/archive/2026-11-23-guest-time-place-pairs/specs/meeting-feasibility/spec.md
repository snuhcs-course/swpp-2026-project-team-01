# Spec Delta

## ADDED Requirements

### Requirement: Time and place pairs
When an in-person request names no place and the host's confirmed location answer lists places, each candidate SHALL be a pair of a time and one of those places, the venue first and then the areas in the host's order. Each pair SHALL pass every feasibility check with its own place as the meeting place, including both parties' travel legs, buffers, allowances and unresolved rules. The candidate cut before the travel check SHALL count pairs, so an evaluation needs no more route estimates than with one place. The requester SHALL see each pair's time and place, with each time's first offered pair before any time's second. A request that names a place, a host who decides the place per meeting, and online meetings SHALL keep one place or none per candidate. Observed place evidence from calendar analysis SHALL NOT become a pair's place.

#### Scenario: Two host places
- **WHEN** the host lists a venue and one area, the guest asks to meet in person without naming a place, and a time is free
- **THEN** that time is checked once at the venue and once in the area, and each feasible pair is its own option showing its time and place

#### Scenario: Travel decides the place
- **WHEN** the host's commitment before a time leaves too little gap to reach the venue but enough to reach the area
- **THEN** the pair at the area is offered and the pair at the venue is not, and the guest sees no reason

#### Scenario: Guest named a place
- **WHEN** the request names a place
- **THEN** every candidate is at that place only, with the candidate IDs and order it had before pairs existed

### Requirement: Another meeting area
When the guest asks to meet in another area, its place SHALL become the request's place through the existing review, and the next evaluation SHALL offer only pairs at that place under the same checks. When none is offered, the requester SHALL be told that no time works there yet, with no reason that reveals the host's calendar, commitments, travel, allowances or rules. Asking for another area SHALL count as an evaluation under the existing limit per request.

#### Scenario: Feasible pairs elsewhere
- **WHEN** the guest asks for another area and some times there fit the host's calendar and travel
- **THEN** the guest sees those times, each with the area they asked for

#### Scenario: Nothing works there
- **WHEN** no time in the guest's area passes the checks
- **THEN** the guest is told no time works there yet and may try another area, other days or one of the host's places, and nothing names the host's events or trips

#### Scenario: Repeated areas
- **WHEN** a guest who already started 10 evaluations of the request in the last hour asks for yet another area
- **THEN** no evaluation starts and the guest is told to try again later

### Requirement: The chosen pair stays as chosen
Choosing a pair SHALL make a proposal with exactly its time and place. Agreement's calendar recheck and booking revalidation SHALL check that pair's place, and the host's approval and the booked event SHALL carry that place unchanged.

#### Scenario: Recheck at the chosen place
- **WHEN** the guest chose the pair at the area and agrees to it
- **THEN** the recheck checks travel to the area, not to the venue, and the host approves and books the area at that time
