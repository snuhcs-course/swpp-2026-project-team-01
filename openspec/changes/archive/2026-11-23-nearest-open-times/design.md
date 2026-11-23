# Design

## Context

See [proposal.md](proposal.md). The evaluation job (`lib/server/evaluation.ts`) reads the host's and the requester's calendars over whole weeks around the requested windows, runs the pure feasibility engine (`lib/server/feasibility.ts`) over the windows, and stores a requester projection that `evaluate_candidates`, `read_request`, an applied availability draft and the candidate times card all read.

## Decisions

### 1. Where the nearest times are found: in the evaluation, not the instructions

The instructions alone cannot find a nearest time: the assistant sees no calendar, and asking it to widen the window and search again is a second evaluation, a second model step and no guarantee it happens in the same reply. So the evaluation finds them. When the search is the requester's own search over their windows (not a fixed interval, not the default two-week search, not the host's review) and nothing is offered, it runs the same engine over one day at a time moving outward from the windows: the day before the first window and the day after the last, then the next ones, for up to seven days on each side. The before side keeps the latest offered time, the after side the earliest. The requester's preferences are left out of these passes, since they only order times.

The calendars are read once, over a range widened by seven days on each side, so the nearest passes need no new calendar call. Route estimates for in-person passes are fetched as needed under the same deadline. The nearest search stops, keeping what it found, when less than four seconds of the deadline remain or an estimate fails, so it never costs the main result.

Only offered times count, and below the host's weekly limit when one is set, so a nearest time never needs the host to waive a rule.

Rejected: only an instruction to suggest other days | the assistant cannot know which days work. Rejected: a second evaluation over a widened window | it reorders by preferences and ranking, can return times in the gaps far from the window, and repeats the calendar reads.

### 2. What the guest gets

The stored projection gains `nearest: { before, after }`, each a requester candidate or null, only when nothing (offered or trip-dependent) is shown and at least one was found. The guest's tools return it as `nearestTimes` with time, length, form and place, and without an ID: they lie outside the guest's windows, so `choose_time` cannot take them. When the guest picks one, the assistant drafts that exact time as availability, which is applied at once and returns it as an ordinary candidate to choose.

The message becomes the nearest-times message, which offers the times and, for a guest-named place, still suggests another area or one of the host's places. The candidate times card lists them under **Nearest open times** with no choose button and a line to tell the assistant or edit the times. Without nearest times the message and card are as before.

Rejected: putting them in `candidates` | the card and the assistant present candidates as times within the guest's windows, and choosing would skip the guest's consent to a time they did not give.
