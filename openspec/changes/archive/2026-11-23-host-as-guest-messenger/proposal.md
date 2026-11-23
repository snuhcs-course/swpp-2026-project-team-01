# Proposal

Tracking issue: #334 (testing baseline R01 M-1 to M-8; owner decision of 2026-11-23). This change also completes #61, split out of guest-flow-completion task 6.3. Related: #137, #183, account-request-identity (#395, the account identity and calendars this change reuses).

## Why

A host who needs a meeting with another host can start one only from the web booking link; the host and setup tools create nothing. A guest-host's request notices reach a messenger only after **Get updates in iMessage** and a link code, and then the same number holds two conversations, so free text stops at a picker ("Which conversation is this message for?"). `list_host_requests` lists received requests only. The [testing baseline](../../../../documentations/technical_specification/12_testing_baseline.md#r01-one-account-as-host-and-guest) R01 and the owner's decision on #334 say one linked conversation holds both roles: a link or `@handle` starts the request as the account, messages route by context, the request's notices arrive in the same conversation, and received and sent requests are listed apart. #61 asks the same for a guest-host who starts on the web.

## What Changes

- **Start from the conversation (R01 M-1, M-1.1, M-2).** A new host tool, `start_request`, in the host setup and host review tool sets, takes the booking link (`findmeatime.com/dodo`) or `@handle` the host sent in their linked iMessage, WhatsApp or Telegram. It creates the request as the account (`createAccountRequest`: name, Google-verified address, host timezone, host calendars decided at creation), or continues the account's open request with that host unless the host asks for another meeting. The host's own link starts nothing. An unknown, unready or paused host gets the neutral "I can't find a host taking requests at that link."
- **The host conversation is the guest conversation.** The request's requester binding is bound to the host binding's own sender with no link code (`link_id` null), as guest-flow-completion design 6 anticipated. The host binding's `selected_request_id`, which already names the received request a message goes to, may now name such a sent request.
- **Routing by context (R01 M-5, M-6).** For requests bound this way there is no picker: `request <ref>` names one (a reference one of the host's own requests shares stays the host's), a message that says the sender is the host goes to setup, another host's booking link or @handle goes to the host role so `start_request` reads it, a message that names another such request (by reference, or by its host's full name while setup or a sent request is selected) selects it, and otherwise the selected request receives the message. While a received request is selected only a reference moves away from it, so the host's words about their own guests never reach another host's request. The two roles share one WhatsApp window. The latest notice moves the selection: a host notice selects the received request (unchanged), and a guest notice of a sent request selects it, except during the host tutorial. Guest links made with **Get updates in iMessage** keep the #137 picker.
- **Updates in your host conversation (#61).** The **Use your host settings for this request** card offers a third item when the account has a linked messenger. Choosing it binds the request to the host conversation (with the Linked welcome there), unchecking it unlinks it; its notices then arrive there and `request <ref>` resolves it there. No other host's request resolves, and nothing reaches the request's host.
- **Received and sent apart (R01 M-8).** `list_host_requests` returns `sent` (the account's linked sent requests, by host, purpose, status and reference) beside the received requests, and the instructions say to report them apart.

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Where the guest role lives | A requester binding on the host binding's sender, with no link: the requester discussion, notices and closure rules stay the guest flow's own. Rejected: giving the host session requester tools, which would mix the host and guest projections in one model context |
| D2 | Routing state | The host binding's existing `selected_request_id`, for sent as for received requests; no schema change. Rejected: deciding from the latest outbound row, which the host's own turn reply moves |
| D3 | #61 opt-in record | The active requester binding with no link is the record of the choice; `requester_host_profiles.items` keeps its two items. Rejected: a third item value, which needs a migration of the check constraint |
| D4 | Replay | A suppressed `signal` outbox row keyed by the tool call marks a finished start, so a replayed call returns the same request |

## Known limits

- A binding with no link is read as a host-conversation binding. A code-linked guest binding whose link row the 30-day cleanup later deletes (a revised request's binding) also reads as one; it then follows the selection instead of the #137 picker. The sender is the same person, so nothing crosses accounts. Rejected for now: a marker column, which needs a migration.
- Unlinking the host conversation (`stop` or the browser) leaves request bindings on it active; their guest notices still reach that chat until the request closes.

## Not in this change

R01 M-2.1 (choosing calendars for one request in words) and the rest of M-7 (a message that only implies setup, such as "make my meetings 45 minutes", while the conversation is on a sent request) stay open on #334: the guest-role discussion has no setup tools, and routing by meaning needs a design of its own.

## Capabilities

### Modified Capabilities

- `meeting-requests`: a host starts and follows a request to another host from their linked messenger, and a guest-host's request can use their host conversation.

## Impact

`lib/server/host-sent-requests.ts` and `lib/server/host-conversation-bindings.ts` (new), `imessage-receipts.ts` (routing), `imessage-notice-job.ts` (selection on a guest notice), `requester-imessage-bindings.ts`, `requester-host-profiles.ts` and `requester-routes.ts` (#61), `guest-thread.ts`, `host-review-tools.ts` and `setup-channel-tools.ts` (sent list), the agent tools and host messenger instructions, the host-profile card, the owning documents and tests. No schema migration, provider grant or new route.
