# Find Me a Time — Module Test Map

Status: first version\
Date: 2026-11-24\
Basis: [Testing baseline](12_testing_baseline.md) at `aff38155`, after the merged work on #326, #329, #330, #331, #332 and #334; the repository owner's 2026-11-23 decisions on [#325](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/325) and its sub-issues #326 to #334

Testing is split into four levels: module tests, AI response tests ([story path evaluation](13_story_path_evaluation.md)), UAT and QA ([QA sheet](16_qa_sheet.md)). This map is the module level. It takes every testing baseline row marked **supported** whose behavior code decides, and names the automated test that pins it: a unit test (`npm test`, beside its module) or, where the behavior lives in a database command, an integration test (`npm run test:integration`, in `tests/integration/`). A regression in one of these rows fails a named test.

The table also includes a few rows the baseline does not mark supported but whose outcome is fixed code: H01 M-10's fail branch, H02 M-10 and H03 M-6 (no code status), H04 M-2.1 (supported in part) and R01 P-9 (to verify, for the agent's wording only). Rows tested only by their copy are marked "(copy)"; the integration column covers when that reply is chosen.

Rows are named `{story} {step}` as in the baseline. Rows marked **not supported** or **differs from code** are product gaps, not test targets, and are tracked in [#255](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/255). Rows whose supported part is a rule in the instructions or a tool description are AI judgment and belong to the AI response tests ([below](#supported-rows-decided-by-the-assistant)).

## Rows and their tests

Test names are quoted; a file without a name means a `describe` block named after the row.

| Row | Behavior code decides | Module test | Integration test |
|---|---|---|---|
| H01 M-1b.1 | `set_calendar_roles` saves the roles and starts the analysis; a read-only booking calendar is refused with `saved: false` | — | `host-onboarding-in-chat.test.ts` "adds a live calendar but refuses a read-only destination and a web turn" |
| H01 M-6.1 | `draft_settings` records several fields in one call | `lib/server/setup-tools.test.ts` "describes draft_settings to the model as JSON Schema", "refuses accepted flags and unknown fields in draft_settings input" | `setup-tools.test.ts` "writes values unaccepted and labeled, and rejects a stale revision" |
| H01 M-6.2, H02 M-2.1 | Hours can differ by weekday | `lib/contracts/setup.test.ts` "keeps a different window per weekday" (new) | — |
| H01 M-10.3 | A drafted handle is checked for availability | — | `handles.test.ts` "rejects another host's current or released handle…"; `setup-confirm.test.ts` "rejects a handle another host took after it was drafted…"; `setup-commands.test.ts` "keeps the previous handle when the drafted one is another host's or invalid" |
| H01 M-10 (fail), H02 M-2 | `confirm_settings` saves only the current review, after the host's yes to its image | — | `channel-actions.test.ts` "saves nothing for a review that is not the current one"; `host-onboarding-in-chat.test.ts` "blocks an unsent preview, a changed place after an image, and all three actions from a web turn" |
| H02 W-5.1 | A paused host is treated like an unready one, so the booking link is the neutral not-found page | `lib/server/readiness.test.ts` "treats a paused host like an unknown handle", "treats an unready host, or one without a display name, the same way" (new) | `host-intake.test.ts` "defaults on, saves a revisioned pause, replays a lost response, and rejects stale views" |
| H02 M-3 | Meeting length 15–240 minutes, in steps of 5 | `lib/contracts/setup.test.ts` "takes a meeting length of 15 to 240 minutes in steps of 5" (new) | — |
| H02 M-4, H03 M-8.2 | Weekly limit 1–50, or none | `lib/contracts/setup.test.ts` "takes a weekly limit of 1 to 50 meetings, or none" (new) | — |
| H02 M-9 | `keep_busy` is recorded at once; `free` waits for the host's yes | — | `weekly-note-check.test.ts` "keeps entries busy by number without a read-back, and does not ask about them again", "reads the choice back, frees nothing until the host's yes, then frees both once" |
| H02 M-10 | Each weekly-list answer that cannot be acted on says nothing changed | `lib/server/channel-texts.test.ts` "says nothing changed for each weekly-list answer it cannot act on" (new, copy) | `weekly-note-check.test.ts` "changes nothing for an older list, a number not on it, or an entry edited since" |
| H03 M-2.3 | Approving a superseded version points to the current one | `lib/server/channel-texts.test.ts` "points an approval of a superseded version to the current one" (new, copy) | `imessage-commands.test.ts` "changes nothing for an outdated or unknown reference, or a plain yes" |
| H03 M-4 | `propose_shared_changes` only drafts; the guest sees nothing before `share_changes` | — | `host-review.test.ts` "fences the tools to the session's own request and live generation"; `channel-actions.test.ts` "shares the pending suggestion for a message from iMessage, once" |
| H03 M-6 | Unknown and removed request references | `lib/server/channel-texts.test.ts` "names an unknown or removed request reference" (new, copy) | `imessage-switching.test.ts` "selects a request by its reference, and goes back to setup" |
| H03 P-4 | The host's MCP has `waive_weekly_limit` and `allow_host_trip` | `lib/server/agent-mcp.test.ts` "lets a host's agent waive the weekly limit, allow a trip and check a booking" (new) | `host-requests.test.ts` "holds every candidate in a full week until the host waives the limit (Only full weeks)", "applies a host allowance for an unresolved trip of one candidate…" (the commands) |
| H01 W-A6, W-A7, W-B4, G01 W-10.3 | Linking a messenger on the code's arrival | The baseline row names its tests: `imessage-links.test.ts`, `imessage-start.test.ts`, `requester-imessage-links.test.ts` | (as named in the row) |
| H04 M-1, R01 M-8 | `list_host_requests` lists received requests, with sent requests apart | `lib/server/host-sent-requests.test.ts` "lists sent requests apart from received ones, by host" | `channel-actions.test.ts` "lists the host's requests in setup, on the web too (#138)"; `host-as-guest-messenger.test.ts` "lists sent requests apart from received ones" |
| H04 M-2 | The request list gives each request's time and week | `lib/server/host-schedule.test.ts` "starts today in the host's timezone and covers seven days by default" | `host-requests.test.ts` "lists a confirmed booking's time and its week for the model (issue #300)" |
| H04 M-2.1, M-2.2 | `read_schedule` labels booked meetings, other calendar events and sent requests apart | `lib/server/host-schedule.test.ts` "labels each entry by where it comes from, with local times, weeks and quoted text" | — |
| H04 P-3 | MCP `get_schedule` under host:read, read-only | `lib/server/agent-host-tools.test.ts` "reads the schedule under host:read and only reads" | — |
| G01 W-4.1 | The composer locks only before the first handover | `apps/web/app/_components/guest/composer-state.test.ts` "locks before the first handover while the Calendar step is open", "stays usable when the Calendar step reopens after the handover, and says it reopened" | — |
| M01 W-G1, W-G2 | A booked booking page keeps its conversation; a change reopens the request | `apps/web/app/_components/guest/booked-workspace.test.tsx` "keeps the conversation open under the confirmed receipt" | `booking-changes.test.ts` "reopens a booked meeting that keeps standing, and offers its own time again", "keeps the booked meeting when the requester withdraws the change" |
| R01 M-1 | `start_request` takes another host's link or handle from the host's linked messenger | `lib/server/host-sent-requests.test.ts` "takes the link or handle and asks for another meeting only explicitly", "refuses a session that is not a host's own" | `host-as-guest-messenger.test.ts` "is the account's, counts its calendars, and takes the host's next message without a picker" |
| R01 M-1.1 | The host's own link or handle starts nothing | `lib/server/host-sent-requests.test.ts` "answers own for the host's own link and writes nothing" (new) | — |
| R01 M-2, P-3 | A request from the account uses its identity and counts its host calendars | — | `host-as-guest-messenger.test.ts` "is the account's, counts its calendars, and takes the host's next message without a picker"; `agent-mcp-account-requester.test.ts` "identifies the request with the account and counts its host calendars without asking" |
| R01 M-5 | Free text follows the host binding's selection; saying "I'm the host" goes to the host role | `lib/server/host-sent-requests.test.ts` "names a sent request by its host's full name only, never by one word", "goes to the host role when the sender says they are the host" | `host-as-guest-messenger.test.ts` "keeps the host's words on a received request and sends another host's link to the host role" |
| R01 M-6 | Guest notices of a request started from the host conversation arrive there | — | `host-as-guest-messenger.test.ts` "a guest notice selects the sent request again after the host moved to setup" |
| R01 P-2 | The account `create_request` takes no name or email | `lib/server/agent-account-requester-tools.test.ts` "needs neither identity nor timezone", "refuses a typed name or email" | `agent-mcp-account-requester.test.ts` "identifies the request with the account and counts its host calendars without asking" |
| H04 P-2, G03 P-2 | `check_booking` for the host's and the guest's agent | `lib/server/agent-mcp.test.ts` "lets a host's agent waive the weekly limit, allow a trip and check a booking", "lets a guest's agent check its booking once the request exists" (new) | `bookings.test.ts` "starts another reconciliation from Check booking status after retries ran out" |
| G01 W-6.3 | Same-day trips order candidates without removing any | `lib/server/feasibility.test.ts` "same-day trips": "offers days already out that way first and days in the preferred area last, removing nothing" | — |
| G01 W-6.4 | `read_request` gives the fixed calendar privacy reply | `lib/contracts/feasibility.test.ts` "the calendar privacy reply (#311)" | `request-tools.test.ts` "returns the requester projection with contact presence and no host context" |
| G01 W-7.4 | A draft held for review (inferred values, changed values, name or email; since #419 stated details apply at once) is never applied once dismissed | — | `request-reviews.test.ts` "dismisses a pending review as rejected without changing the request" |
| G02 M-3 | A message in a closed request's messenger conversation starts a revised request; the closed notice when it cannot | — | `revised-requests.test.ts` "starts one revised request after a decline…", "starts a revised request after the guest withdrew (U16)", "answers with the closed notice and creates nothing when the chain is full, the host is unavailable or the bounds refuse" |
| G02 E-1 | An email reply reaches the same request's guest conversation | — | `email-notices.test.ts` "starts a thread for a request without one, binds it, and the guest's reply reaches the request"; `email-links.test.ts` "forwards later replies whose subject or quoted text repeats the code…" |
| G03 M-6 | A non-text message gets the text-only reply | `lib/server/channel-texts.test.ts` "says that only text messages reach Thyme" (new, copy) | `imessage-channel.test.ts` "answers a bound host's non-text message with one fixed reply"; `telegram-channel.test.ts` "answers content other than text with Telegram's text-only reply" |
| M01 W-G3 | Cancelling or changing is refused once the meeting started | — | `booking-cancellation.test.ts` "refuses once the meeting has started"; `booking-changes.test.ts` "refuses a request that is not booked, and a meeting that has started" |
| R01 M-4 | Host notices go to the host binding of a host who is also a guest | — | `requester-imessage-routing.test.ts` "keeps a host's commands and host notices on the host side for a host who is also a guest" |
| R01 M-8.2 | Host-profile data never reaches the request's host | — | `requester-host-profiles.test.ts` "leaves out times their host conflict calendar is busy, and the request's host sees nothing of it" |
| R01 P-1 | A host-only grant needs added consent on the same server to create a request | `lib/server/agent-mcp.test.ts` "needs the request permissions before a host-only grant can create a request" (new) | `agent-mcp-account-requester.test.ts` "keeps received and sent tool names separate and host-only grants need new consent" |
| R01 P-4, P-5, P-7 | Received and sent requests side by side on one connection (the module test checks the tool list; the integration test checks that the sent tools reuse the requester tools by requestId) | `lib/server/agent-mcp.test.ts` "offers received and sent requests side by side on one host connection" (new) | `agent-mcp-account-requester.test.ts` "chooses and agrees as requester, waits for the other host, then reads and cancels the booked meeting" |
| R01 P-9 | `create_request` to one's own handle is refused | — | `agent-mcp-account-requester.test.ts` "refuses expired links and revocation, suspension, self-booking and paused targets" |

## Rows without a module test

Each of these rows has an integration test (above) and no unit test, because the behavior is a database command or a channel route that a unit test could only mock away: H01 M-1b.1, M-10.3, H01 M-10 and H02 M-2, H02 M-9, H03 M-4, G01 W-7.4, G02 M-3, G02 E-1, M01 W-G3, R01 M-2, M-4, M-6, M-8.2, P-3, P-9. They run with `npm run test:integration` against the local stack. Their known gaps, not closed here:

| Row | Untested part |
|---|---|
| H01 M-1b.1 | The refusal when the calendar list changed, and the `analysisStarted` result |
| H01 M-10.3 | `draft_settings` with a handle is never called, so its "This handle is not available (…)" text is not pinned |
| H03 M-4 | No test asserts that a drafted suggestion alone makes no new version and sends nothing |
| G01 W-7.4 | No test applies a dismissed review and expects the refusal |
| G02 M-3 | The closed notice is sent once per link; no test sends a second message |
| G02 E-1 | The only reply test starts from a decline notice, not a booking-link email on an open request |
| R01 M-4 | The routing test does not assert the outbox row's binding |
| R01 M-8.2 | The host's model context (`read_request` for the host) is not checked |
| H04 M-1 | "You have no open requests." is pinned only for the messenger `requests` command, not for `list_host_requests` |
| H04 M-2.1, R01 M-8 | `read_schedule`'s sent-request query has no database test |
| H04 P-3 | No test checks that `get_schedule` returns the same entries as `read_schedule` |
| M01 W-G1, W-G2 | The booking page switching back to the usual workspace once a change starts, and its "This meeting was cancelled." line |
| R01 M-1 | Continuing an existing open request, and the unknown or paused handle refusal, through `start_request` itself |
| R01 M-5 | A host notice selecting the received request |

H02 P-1 and H04 M-4 (reading only the Google Calendars the host chose) have no test at either level: both are database and Google reads, and for `get_setup` only `revision`, `nextStep` and `proposalHash` are read in the MCP integration tests.

## Supported rows decided by the assistant

These rows are marked supported because the rule is in the instructions or a tool description; whether the assistant follows it is AI judgment, so they belong to the AI response tests, not here: H01 M-2, M-4, M-4.1, M-4.2, M-4.4; H02 M-1, M-10.1; H03 M-2.1, M-2.2, M-2.4, P-2.1; H04 M-3, P-1; G01 W-6.1, W-6.2, W-6.5, W-6.6, W-7.1, W-8.1, W-8.2, W-8.4; G02 W-1.1, W-3.1, M-1; G03 W-6.1, M-5, M-5.1, M-5.2, P-1; M01 W-G2.1, M-2, P-2; A01 M-1, M-3; R01 M-8.1. The code-decided part of G01 W-6.3 (trip ordering) is mapped above.

## Rows waiting on the #325 decisions

The owner's 2026-11-23 decisions change these rows, so they get no test now; a test follows with the change that builds them ([#255](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/255)). The work on #326, #329, #330 (except the schedule image), #331, #332 and #334 (except R01 M-7) has landed; its rows that the baseline now marks supported are in the table above.

| Row | Waiting on | Why |
|---|---|---|
| The 21-window cap in H01 M-6.2 | [#328](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/328) | Alternate-week hours and per-week exceptions change how hours are stored; the per-weekday rule itself is tested |
| H02 P-1's `nextStep` | [#328](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/328) | `nextStep` is to point to `confirm_setup` after an MCP change (H02 P-2) |

The rows the open sub-issues still change (#327: H03 W-6, M-7, M-8 to M-8.3; #328: H01 M-2.1, M-6.3, M-8, M-10.1, H02 M-2.2, M-5, M-6, P-2, P-3; #330: H04 M-5; #333: A01 W-H6, M-2, M-4.1, M-5; #334: R01 M-7, H04 P-1.1) are not supported or differ from code today, so they are not module test targets yet. H01 M-2.1 and H02 M-5 already have a unit test from #268 (`setup-tools.test.ts` "offers new hours after a calendar change even when the host already answered"); #328 confirms them against the baseline.

## Found while mapping

- **G03 M-6 on Telegram.** The guest branch of `lib/server/imessage-receipts.ts` (line 666) always sends the plain "I can read text messages only.", so a guest who sends a photo on Telegram does not get the Telegram wording ("Photos, stickers and voice messages don't reach Thyme.") that hosts get. The baseline row quotes the Telegram wording for the guest's messenger. The test pins the two copies only.
- **G01 W-7.4 after #419.** Stated details now apply without the review card, so the row's "a draft is applied or dismissed on the review card" holds only for a draft held for review. The baseline row should say so.
- **`host-review.test.ts` may be stale.** It expects the host review tools to equal a list without `start_request`, which `agent/tools/request.ts` now adds (R01 M-1). It is an integration test and was not run here.
