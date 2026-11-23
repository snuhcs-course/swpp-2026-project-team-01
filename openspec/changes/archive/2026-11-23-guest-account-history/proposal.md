# Proposal

Tracking issues: [#48](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/48) (guest account retention) and [#233](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/233) (one page of a guest's requests), with the guest part of [#228](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/228) (account deletion). The repository owner decided all three on 2026-11-23 in the issue comments.

## Why

Anyone who signs in with Google gets an account ([host-admission](../../../specs/host-admission/spec.md)), and an account that books with another host is a guest account: its requests are matched to it by a verified Google subject or the signed-in session ([host-as-guest-session](../2026-11-23-host-as-guest-session/), [request-dashboard](../2026-11-24-request-dashboard)). Three things did not fit that account yet:

- A closed request is deleted 90 days after it closed ([operations-and-release D9](../2026-11-24-operations-and-release/design.md#8-retention)), so an account's history disappeared on the same schedule as an anonymous guest's.
- The Requests list linked a sent request only while its private link lasted, and the request page shows nothing but a status once a request closes, so a closed request's conversation could not be opened at all.
- Deleting an account ([self-service-account-deletion](../2026-11-24-self-service-account-deletion), or `delete-host`) removed the account's matches to the requests it sent but left those requests open and their booked meetings standing with other hosts. A guest account with no handle could not be named to the operator command either.

## What Changes

- **History is kept while the account exists.** The retention pass skips a closed request matched to an account that is not deleted. Deleting the account removes the match, and the request then follows the 90-day rule with its host. Requests without an account keep the 90-day rule.
- **One page of requests.** The Requests list in `/app` keeps every sent request: an open one opens its request page as before, and any other one (booked, declined, withdrawn, expired, cancelled) expands to its own conversation, read only, served by `GET /api/host/workspace-requests/{requestId}/conversation` after the account match is checked. The agent serves that read for a closed request only while an active, undeleted account owns it.
- **Calendar grant.** A request that uses the account's own Google connection uses the account grant, which lasts until the account disconnects Google or is deleted; closing the request clears only that request's choice. Request-bound grants of guests without an account are unchanged.
- **Deleting a guest account.** `app.operator_delete_host`, which both the Settings deletion and the operator's `delete-host` run, publishes one `account_requests_close` job for the account's sent requests that are open or have a meeting still to come. The job withdraws each open one and cancels each booked meeting that has not started, as a requester's cancellation does: the event is deleted and the host is told. `delete-host` also takes the account's Google address. The Settings card and the scheduled-deletion email say so.
- **Notice.** `/privacy` describes the kept history, the account's Google connection and what deletion does to sent requests, in English and Korean.

## Out of scope

- A per-request **Delete my details** link for a guest without an account (#228's proposal): the 2026-11-23 decision made deletion an account action; a guest without an account still writes to support, and the operator runs `delete-request`.
- Host deletion itself (#239) and what a host's deletion does to requests it received: unchanged.

## Capabilities

### New Capabilities

- `guest-account-history`: a signed-in guest account's request history and conversations, its Calendar grant, and what deleting it does to the requests it sent.

### Modified Capabilities

None in `openspec/specs/`. Retention and operator deletion are still pending deltas of [operations-and-release](../2026-11-24-operations-and-release/specs/data-stewardship/spec.md), the sent list is a pending delta of [request-dashboard](../2026-11-24-request-dashboard/specs/chat-workspaces/spec.md), and Settings deletion one of [self-service-account-deletion](../2026-11-24-self-service-account-deletion/specs/host-account-deletion/spec.md). This change adds its rules beside them, and changes request-dashboard's sent-card scenario to open only an open request's page.

## Impact

- Schema: `app.cleanup_retained_records` and `app.operator_delete_host` replaced in one hand-written migration (`supabase migration new guest_account_history`), not generated, not yet applied.
- Server: `lib/server/account-requests-close.ts` (new job), `lib/server/booking-cancellation.ts` (`cancelLockedMeeting` shared with `booking.cancel`), `lib/server/eve-auth.ts`, `lib/server/workspace-requests.ts`, `lib/server/host-request-routes.ts`, `lib/server/data-deletion.ts`, `lib/server/account-emails.ts`, `lib/server/job-handlers.ts`.
- Web: the conversation route, `apps/web/app/_components/host/host-requests.tsx` and `sent-request-conversation.tsx`, the Delete account card, `/privacy`.
- Documents: the operator runbook in provider setup, the PRD's data rule, the page list and the decision log, with their Korean mirrors where one exists.

This change has two tracking issues because the owner decided #233 as part of #48's rules; #228 stays open for its remaining archive task in `self-service-account-deletion`.
