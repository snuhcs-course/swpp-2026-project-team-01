# Proposal

Tracking issue: #334 (testing baseline R01 P-2 and P-3; owner decision of 2026-11-23). Related: #61, #137.

## Why

An account connected to `/mcp` with request scopes can request a meeting with another host ([account-requester-mcp](../../account-requester-mcp/proposal.md)), but `create_request` still takes `name` and `email` "using only their stated identity", so the agent must ask the person who they are, and the request is linked with no host-profile items, so the account's own host calendars do not count as busy time. The [testing baseline](../../../../documentations/technical_specification/12_testing_baseline.md#r01-one-account-as-host-and-guest) R01 and the repository owner's decision on #334 say the account is the requester: its name, Google address and calendars are used without asking.

## What Changes

- **Identity from the account.** The account connection's `create_request` no longer takes `name` or `email`. The request is identified with the account's host display name (settings, else account) and the Google address it signed in with, stored as the confirmed contact, as **Continue as {name}** does on the web ([host-as-guest-session](../../host-as-guest-session/proposal.md) D1). `timezone` becomes optional and defaults to the account's host timezone; an account without host settings must still name one.
- **Host calendars by default.** The account link is created with the host-profile Calendars item already decided, so the account's host conflict calendars count as the requester's busy time ([guest-flow-completion design 6, D8](../../guest-flow-completion/design.md#6-host-profile-for-a-guest-who-is-a-host)), and the Calendar step is settled. An account without conflict calendars is linked with no items. Because such a request has no Calendar card to reopen, a failed host grant keeps the item (decided at creation: `decided_at` equals `created_at`) and each search fails with `requester_calendar_unavailable` until the account reconnects Calendar, instead of dropping the item and treating the person as free.
- **Say which calendars count.** The result returns `requester` (name and email), `calendars` (the conflict calendar names) and `calendarReadable`, and its `next` tells the agent to mention them once, or to ask for a Calendar reconnect first.
- The anonymous per-host `create_request` is unchanged: it still takes the person's stated name, email and timezone.

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Identity source | The account's verified identity, never a typed name or address: the same source as `request.identify_account`. Rejected: keeping `name` and `email` as optional overrides, which would let an agent attach another address to a request linked to the account |
| D2 | Calendars default | Decided at creation with the Calendars item, because the account itself asked for the meeting; a failed host grant still drops the item and reopens the Calendar step (design 6), never free time. Rejected: leaving the decision open for the web card, which an MCP-only person never sees |
| D3 | Shared creation | One helper (`lib/server/account-requests.ts`) creates and links an account request, so the messenger start (R01 M-1, a later change) uses the same rules |
| D4 | Failed host grant | Keep the item for a request decided at creation and pause every search; the web keeps dropping the item and reopening the Calendar card. Rejected: a new `requester_host_profiles` column for the origin (a schema change for one flag) |

## Capabilities

### Modified Capabilities

- `agent-client-authorization`: an account connection's sent request uses the account's identity and host calendars.

## Impact

`lib/server/account-requests.ts` (new), `lib/server/agent-account-requester-tools.ts`, `lib/server/requester-host-profiles.ts` (`dropGuestHostCalendars`), `lib/server/agent-requests.ts`, the public entry instructions (`entry-documents.ts`), the agent client documentation and tests. No schema migration, provider grant or new route.
