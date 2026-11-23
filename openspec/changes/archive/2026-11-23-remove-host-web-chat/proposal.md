# Proposal

Tracking issue: #326

## Why

The repository owner decided on 2026-11-23 that a host talks about a request only in their linked messenger (iMessage, WhatsApp or Telegram), never in a chat on the web. The [`request-page-accordion` change](../../request-page-accordion/proposal.md) already took the **Private messages** chat out of the Requests list. The web chat routes still accept a `request` scope, so a browser can still open, read and recover a host-private request discussion that no web page shows. The [testing baseline](../../../../documentations/technical_specification/12_testing_baseline.md) also expected the web to show only Approve, Decline and the details, which the owner's decision reverses for the other controls.

The owner's principle for this epic is that everything a host can do on the web must also be possible in the host's messenger.

A later update the same day widened the decision: the host web keeps no chat with Thyme at all. Setup happens only in conversation in the messenger (iMessage, Telegram). The web keeps the settings screens, the dashboard and the request view, and a host with no linked messenger is led to link one first, as [#190](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/190) already requires after Google sign-in.

## What Changes

- The setup conversation leaves `/app`: no authored messages, composer, history, streamed reply, receipts timeline or **Restart Thyme**. A ready host's workspace shows the share links, the sample request offer and the messaging card as cards. A host whose setup is incomplete, who normally stops at the link step (#190), sees only "Finish setup with Thyme in your messaging app" and the messaging card, with no setup questions.
- The web app mounts no `/api/chat` route. `useHostDiscussion`, the host functions of `apps/web/lib/chat/discussion.ts` and the setup receipt and tool-label modules are deleted. The link step's **Set up here in web chat** becomes **Go to your workspace**.
- `lib/server/chat-routes.ts` keeps its handlers, unmounted, as the HTTP adapter the conversation integration suites drive; `recoverDiscussion` keeps a server-only `requestId`.
- The browser tests of the web chat (`streaming`, `first-reply`, the composer and recovery cases of `workspace`, and the setup wizard in `host-setup`) are removed or rewritten, and the opt-in live-model browser run (`E2E_LIVE_MODEL=1`), which ran only the first-reply journey, is removed.
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

## Paths without a messenger equivalent yet

Removing the setup chat leaves these with no messenger counterpart. This change records them rather than inventing a replacement:

- **Restart Thyme.** Terminal recovery of a failed host discussion (setup or a request) ran only from the web (`POST /api/chat/recover`). A messenger receipt that meets `recovery_required` records the input and waits, so a failed discussion stays stuck until server-side recovery exists.
- **Messenger texts that send the host to `/app` for setup.** "Open /app to set up", "Still needed: … or open /app", "Your settings review is too long for a message. Review and confirm it at /app", "I couldn't save that here. Open /app", and `get_setup`'s "connect Google Calendar at /app". The web has no setup questions to finish there now. The Calendar consent itself still works through `/auth/sign-in?consent=calendar`, and the settings dialog keeps hours, the weekly limit, the preferred place and accepting requests.
- **The model's setup guidance for Calendar steps.** `setupNextStep` in `lib/server/setup-tools.ts` tells the model to have the host "connect Google Calendar at /app" and "choose their calendars at /app". An incomplete, linked host who opens `/app` sees the link step's connected screen, with no Calendar control, and the workspace no longer shows the connect and calendar-choice cards. The messenger has better routes, the consent link (`calendarConnectUrl`) and `set_calendar_roles`, but this change does not rewrite the guidance.
- **Setup cards that a ready host still meets.** A ready host with pending changes still gets the review or step cards on `/app?view=…`, but no browser test covers that path any more.
- **A live-model browser check.** The only browser journey against the real model was the web first reply; none runs against a messenger.


## Impact

- Code: `lib/server/chat-routes.ts`, `lib/server/recovery.ts`, `apps/web/lib/chat/discussion.ts`, `apps/web/lib/chat/use-host-discussion.ts` (deleted), `apps/web/app/api/chat/*` (deleted), `apps/web/app/_components/host-workspace.tsx`, `playwright.config.ts`.
- Open changes that still describe a host setup conversation on the web ([`request-page-accordion`](../../request-page-accordion/proposal.md), [`message-first-web-onboarding`](../../message-first-web-onboarding/proposal.md) and [`host-review-and-booking`](../../host-review-and-booking/proposal.md) modify `chat-workspaces`' **Conversation-first entry**) need their deltas reconciled with **No host chat on the web** before they archive.
- Tests: `lib/server/chat-routes.test.ts` (new), `tests/integration/host-review.test.ts`, `tests/e2e/host-setup.test.ts`, `workspace.test.ts`, `imessage-link.test.ts`, `support/connected-apps.ts` and `support/setup-host.ts`; `streaming.test.ts` and `first-reply.test.ts` deleted.
- Specs: `conversation-access` and `chat-workspaces` deltas.
- Docs: the testing baseline rows H03 (W-2, W-5, W-6) and M01 (W-H1), the agent configuration, the decision log, the acceptance record, the page list and the interfaces overview.
- No schema change. Existing `host_review` discussions opened from the web stay in the database. A messenger can continue them, and the account deletion removes them as before.
