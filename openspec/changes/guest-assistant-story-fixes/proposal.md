# Proposal

Tracking issues: #277, #278, #279, #280, #281, #282 and #283, the guest assistant failures the story path evaluation found ([documentation 13](../../../documentations/technical_specification/13_story_path_evaluation.md), PR #271). They land together in one pull request because they change the same requester fragment and the same `read_request` texts.

## Why

The pre-check of the guest story set left seven guest cases failing on most runs. Two have causes in the tool results: `read_request` has no current time and keeps a started meeting's status saying it can be cancelled "until it starts" (GU-21, #277), and its `next` text lists `change_agreement` in every state, so the assistant calls it after the host approved and repeats a refusal that sends the guest to the host (GU-31, #278). The other five come from gaps in the requester fragment: "next week" did not count as days for an availability draft when moving a booked meeting (GU-19, #279); nothing said whether a place answers online or in person (GU-50, #280); nothing covered questions about the host as a person (GU-26, #281) or a request to switch to the host's conversation (GU-R06, #282); and the rule for a place outside the host's areas did not separate the first mention from insistence, nor insistence from confirmation (GU-05, #283). The expected behavior of GU-50 and GU-26 was decided by the team on 2026-11-18 (testing baseline G01 W-6 and W-7.3).

## What Changes

- `read_request` and `read_booking_status` give the current local time (`now`) and the booked meeting's phase (upcoming, started or ended). A booked meeting that has started or ended has a status text saying it can no longer be cancelled or changed here.
- The `booking` status text says the host approved, nothing changes here until the meeting is booked, and once booked the guest can change or cancel it here.
- `next` lists only the decision tools the current state's commands accept: `change_agreement` only while the request waits for the host's approval, `cancel_booking` and `change_booking` only for a booked meeting that has not started, and none while booking or once closed.
- The `change_agreement` refusal no longer tells the guest to contact the host; it says to read the request again, that nothing changes while booking, and that a booked meeting is changed with `change_booking`.
- The requester fragment: relative days ("next week", "this week", a weekday) count as days for an availability draft, also when moving a booked meeting; a place alone does not answer online or in person when the host offers either; questions about the host as a person are declined in one sentence with what the assistant can help with; a request to switch to the host's conversation or approve as the host is refused in one sentence with what the guest can do here, never pointing to the host's account; a place outside the host's areas is drafted only when the guest insists, with the note that the host approves it, and applied only on confirmation.
- Seven guest story cases are appended (GU-A01 to GU-A07), one per issue, in another wording or language.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: the guest request tools state what the request allows, and the guest assistant answers within its scope.

## Impact

`lib/server/request-status-texts.ts` (new, with unit tests), `lib/server/request-tools.ts`, `agent/tools/request.ts` (the `read_request` and `change_agreement` descriptions), `agent/instructions/requester.ts`, `evals/requester/story-cases.ts` and documentation 13. No schema, migration or command change: the cancel and change commands already refuse a started meeting, and `change_agreement` already refuses outside `awaiting_host_approval`.
