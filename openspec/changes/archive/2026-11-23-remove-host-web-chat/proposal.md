# Proposal

Tracking issue: #326

## Why

The repository owner decided on 2026-11-23 that a host talks about a request only in their linked messenger (iMessage, WhatsApp or Telegram), never in a chat on the web. The [`request-page-accordion` change](../../request-page-accordion/proposal.md) already took the **Private messages** chat out of the Requests list. The web chat routes still accept a `request` scope, so a browser can still open, read and recover a host-private request discussion that no web page shows. The [testing baseline](../../../../documentations/technical_specification/12_testing_baseline.md) also expected the web to show only Approve, Decline and the details, which the owner's decision reverses for the other controls.

The owner's principle for this epic is that everything a host can do on the web must also be possible in the host's messenger.

## What Changes

- `/api/chat/messages`, `/api/chat/state`, `/api/chat/events` and `/api/chat/recover` serve only the host's setup discussion. A route that names a request answers `400 request_scope_unsupported` before anything is read, sent or created. It is never answered from setup.
- The browser client (`apps/web/lib/chat/discussion.ts`, `use-host-discussion.ts`) and the recovery helpers no longer take a request.
- The host-private request discussion (audience `host_review`) is unchanged for the linked messenger, which opens it through `acceptHostMessage` with the request, and for the local host-approval evaluation entry.
- The web keeps **Request changes**, the rule card (**Allow this request beyond my weekly limit**, the trip estimate) and **Cancel meeting** / **Change meeting**, beside **Approve** and **Decline**.

## Messenger parity of the kept web controls

| Web control | Command | In the messenger |
|---|---|---|
| Approve / Decline | `request.approve`, `request.decline` | `approve_proposal`, `decline_request` |
| Find times | `request.host_evaluate` | `evaluate_candidates` |
| Request changes, Share revised details, Dismiss | `request.suggest_changes`, `request.share_changes`, `request.dismiss_changes` | `propose_shared_changes`, `share_changes`, `dismiss_changes` |
| Cancel meeting / Change meeting | `booking.cancel`, `booking.change` | `cancel_booking`, `change_booking` |
| Check booking status | `booking.check` | `read_booking_status` |
| Allow this request beyond my weekly limit | `request.waive_weekly_limit` | **Missing** (testing baseline H03 M-8.1); built in #327 |
| Trip estimate | `request.allow_host_trip` | **Missing** (testing baseline H03 M-8.3); built in #327 |

Two gaps remain, and this change does not fill them: the messenger has no weekly-limit waiver or trip estimate, and no host notice for a weekly-limit hold (H03 M-8). Issue #327 builds them.

## Impact

- Code: `lib/server/chat-routes.ts`, `lib/server/recovery.ts`, `apps/web/lib/chat/discussion.ts`, `apps/web/lib/chat/use-host-discussion.ts`.
- Tests: `lib/server/chat-routes.test.ts` (new), `tests/integration/host-review.test.ts`.
- Specs: `conversation-access` and `chat-workspaces` deltas.
- Docs: the testing baseline rows H03 (W-2, W-5, W-6) and M01 (W-H1), the agent configuration, the decision log, the acceptance record, the page list and the interfaces overview.
- No schema change. Existing `host_review` discussions opened from the web stay in the database. A messenger can continue them, and the account deletion removes them as before.
