# Proposal

Tracking issue: #228

## Why

A host who wants their account gone writes to `support@findmeatime.com`, and the week's operator runs `npm run admin -- delete-host` ([operations-and-release D10](../operations-and-release/design.md#9-deletion-on-request)). That is slow for the host, puts a manual step on a four-person team, and the [privacy notice](../../../apps/web/app/privacy/page.tsx) and [terms](../../../apps/web/app/terms-of-service/page.tsx) can only point at an email address. Issue #228 asked how deletion should work; the proposal comment of 2026-11-16 answered it for hosts, and this change implements that answer.

## What Changes

- **Settings step.** The Settings dialog gains a **Delete account** card. The host types their handle (or, without one, their Google address) and chooses **Delete my account**. `/app?settings=account` opens the dialog at that card, so a chat can link to it.
- **Scheduled, not immediate.** The server records a due time 7 days ahead, publishes one delayed `host_deletion` job, signs the host out of every browser, and emails the host the date and how to cancel. Signing in with Google before the date cancels it and emails the host that it was cancelled.
- **One set of deletion rules.** When the job finds its schedule still current, it runs `app.operator_delete_host` in the same transaction, the function the operator command uses, audited as `self-service`. Before that, every open request's guest is emailed that the host closed their account, and the host is emailed that the deletion ran.
- **Chats do not delete.** Thyme in the web chat, iMessage, WhatsApp and Telegram, and the MCP server's instructions, answer "delete my account" with the Settings link and never delete from a chat.
- **Operators stay.** `support@` and `delete-host` remain for people who cannot sign in. Guest deletion is out of scope ([#48](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/48)).
- **Notice and terms.** `/privacy` and `/terms-of-service` describe the Settings step, the 7-day grace period and the emails, in English and Korean.

## Decisions

The proposal comment left two questions open; this change answers them, and the issue asks the issue owner to confirm before the pull request is opened.

- **Grace period: 7 days.** Long enough to notice the scheduled-deletion email and change one's mind, short enough that a deletion request is honoured promptly.
- **Booked future meetings are not cancelled for the host.** Deletion has never touched calendars (the operator path leaves events in place, and so does the notice). The Settings card tells the host to cancel any meeting they no longer want before the date. Open requests are closed by the deletion, and their guests are emailed.

## Capabilities

### New Capabilities

- `host-account-deletion`: a host schedules the deletion of their own account from Settings, can cancel it by signing in, and is told by email; chats point to Settings.

### Modified Capabilities

None in `openspec/specs/`. Operator deletion (`data-stewardship`: deletion on request) is still a pending delta of [operations-and-release](../operations-and-release/specs/data-stewardship/spec.md); this change reuses its function and leaves its requirement unchanged.

## Impact

- Schema: `app.host_accounts.deletion_due_at`; three account email kinds on `app.email_deliveries`; an `account_emails` rule in `app.cleanup_retained_records`. One generated migration.
- Server: `lib/server/account-deletion.ts` (command, route handler, job handler), `lib/server/google-sign-in.ts` (cancel on sign-in), `lib/server/email-delivery.ts` and `lib/server/account-emails.ts` (account emails), `lib/server/job-handlers.ts`.
- Web: `apps/web/app/api/host/account-deletion/route.ts`, `apps/web/app/_components/host-settings-dialog.tsx`, the sign-in card's notice, `/privacy`, `/terms-of-service`.
- Agent: `agent/instructions/base.md`, `agent/instructions/host-imessage.ts`, the MCP server instructions in `lib/server/agent-mcp.ts`.
- Documents: the [page list](../../../documentations/user_experience/04_page_list.md), [provider setup's operator runbook](../../../documentations/technical_specification/03_provider_setup.md) and the [decision log](../../../documentations/technical_specification/08_decision_log.md), with their Korean mirrors.
