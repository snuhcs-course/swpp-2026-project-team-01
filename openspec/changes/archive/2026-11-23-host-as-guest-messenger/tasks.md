# Tasks

## 1. Server

- [x] 1.1 `start_request` (`host-sent-requests.ts`): read a booking link or @handle, refuse the host's own link and unavailable hosts neutrally, create or continue the account request, bind it to the host conversation and select it, and mark the call for replay.
- [x] 1.2 `bindHostConversation` and `selectSentRequest` (`host-conversation-bindings.ts`); `bindRequester` can skip the Linked welcome.
- [x] 1.3 Routing in `imessage-receipts.ts`: requests bound to the host conversation follow the host binding's selection, `request <ref>`, host words and named requests, with no picker; a revised request stays selected.
- [x] 1.4 A guest notice of such a request selects it (`imessage-notice-job.ts`).
- [x] 1.5 `list_host_requests` returns `sent` apart from received requests.
- [x] 1.6 #61: `request.host_profile.decide` takes `messenger`, the view reports it, the thread receipt names it.

## 2. Agent and pages

- [x] 2.1 Add `start_request` to the host setup and host review tools; update the host messenger instructions and the `list_host_requests` descriptions.
- [x] 2.2 The host-profile card offers **Updates in your host conversation**.

## 3. Documentation

- [x] 3.1 Update the testing baseline R01 rows, the agent configuration tool tables and the guest booking flow, and regenerate their `ko/` mirrors.

## 4. Tests

- [x] 4.1 Unit: link and handle reading, the tool input and session refusal, the sent list projection, the setup tool set.
- [x] 4.2 Integration (`tests/integration/host-as-guest-messenger.test.ts`): account identity and calendars, free text without a picker, `setup`, `request <ref>` and host words, notice selection, the sent list, the #61 opt-in with `request <ref>` resolving only its request, and nothing reaching the request's host. Written but not run here (the local Supabase stack is shared on this machine); the owner runs the integration suite on `main`.
