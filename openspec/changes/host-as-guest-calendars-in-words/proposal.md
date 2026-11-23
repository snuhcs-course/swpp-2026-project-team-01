# Proposal

Tracking issue: #334 (testing baseline R01 M-2.1, M-7 and P-8). Follows [`host-as-guest-messenger`](../archive/2026-11-23-host-as-guest-messenger/proposal.md), which left these rows open.

## Why

A host who requests a meeting with another host can choose whether their own host calendars count for that request only on the web **Use your host settings for this request** card. From the linked messenger or the account MCP connection, "Don't check my calendars for this one" has no tool, so the assistant either cannot do it or reaches for the host's own calendar roles, which would change every meeting they host. And while the host conversation is on a sent request, a message that only implies setup ("make my meetings 45 minutes") reaches the guest-role discussion, which has no setup tools and may take it as the sent request's length.

## What Changes

- **Host calendars for one request, in words (R01 M-2.1).** A requester tool, `use_host_calendars`, in the requester discussion and on the account MCP connection (as a sent-request tool with `requestId`), sets whether the guest-host's host conflict calendars count as their busy time for that request. It changes the request's Calendars item only, never the host settings or calendar roles, and only while times are being chosen; the assistant finds times again. The requester projection shows `yourHostCalendars` (the names and whether they count) for a guest who is a host.
- **A message about the host's own meetings reaches setup (R01 M-7).** While the host conversation has a sent request selected, a message with a settings word ("change my settings", "제 설정") or about the host's meetings in general with a change of length or form ("make my meetings 45 minutes", "내 미팅은 전부 45분으로", "모든 미팅을 45분으로") goes to setup, as "I'm the host" does, and the sent request is unchanged. A message that names this meeting ("make it 45 minutes", "this one") stays with the request; the requester instructions then point to "setup" for the general part and change nothing on the request for it.
- **The account connection says the same (R01 P-8).** The sent `update_request_details` description says a change to the person's meetings in general is their host setup (`update_setup_field`), not the sent request.

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | What one request can hold | All of the host's conflict calendars or none, the existing Calendars item. Choosing only some (such as "skip my work calendar") needs a calendar list per request, which `requester_host_profiles` has no column for; the assistant says it can use all or none and asks. Rejected for now: a migration adding that column |
| D2 | The account-sent marker and the Calendar step | The decision time is kept, so a request the account sent (decided at creation) keeps its no-card handling of a failed Google grant; dropping its calendars keeps the Calendar step settled. On a web request, with no calendar connected for it, using them settles the step and dropping them reopens it, as the card does. While the web card is undecided the tool changes nothing (`card_open`): one sentence about calendars must not answer the card's other choices |
| D4 | Times found with the other choice | A change moves the request to a new revision and, while choosing a time, back to gathering, as a details change does, so earlier times and a proposal are no longer current and cannot be agreed |
| D3 | Routing a message that implies setup | A conservative pattern for the host's settings, or their meetings in general with a change of length or form (a guest also says "my meeting", "제 미팅" or "my booking link" about the request), checked only while a sent request is selected, with a message that also names this meeting left to the request. Rejected: a hand-off tool in the requester discussion, which would answer in two discussions for one message; giving the guest-role discussion setup tools, which host-as-guest-messenger D1 rejected |

## Known limits

- A subset of host calendars for one request (D1).
- Messages that imply setup in other words than the pattern's reach the request's assistant, which changes nothing for them and points to "setup".

## Capabilities

### Modified Capabilities

- `meeting-requests`: the guest-host chooses in words whether their host calendars count for one request, and a message about their own meetings reaches setup.

## Impact

`lib/server/requester-host-profiles.ts` (the command and projection), `request-tools.ts`, `agent-requester-tools.ts`, `agent-account-requester-tools.ts`, `imessage-receipts.ts` (routing), `agent/tools/request.ts`, `agent/instructions/requester.ts`, unit tests and evals, and the owning documents. No schema migration, provider grant or new route.
