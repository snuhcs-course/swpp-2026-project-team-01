# Tasks

## 1. Host Calendar disconnect

- [ ] 1.1 Extract the existing host Calendar disconnect transaction for reuse by the web route and messenger tool; verify the host Calendar route and its integration coverage still pass.
- [ ] 1.2 Add a linked-messenger setup tool that requires an explicit request and the current authenticated host channel; verify it removes the grant and calendar selections and leaves existing requests, bookings, and events intact.
- [ ] 1.3 Update host setup instructions, web disconnect confirmation copy, and the testing baseline; verify the documentation checker passes and the baseline describes paused new requests and reconnect requirements for open requests.

## 2. Guest messenger STOP

- [ ] 2.1 Intercept guest `STOP` and Telegram `/stop` before the assistant, end active guest bindings on that channel, suppress queued messages, and add localized opt-out and re-opt-in guidance; verify unit-level command and copy coverage.
- [ ] 2.2 Add integration coverage for iMessage, WhatsApp, and Telegram guest STOP, multiple request bindings, no assistant input, queued-message suppression, and relinking; verify each affected integration file passes.
- [ ] 2.3 Update the testing baseline for guest STOP and re-linking; verify the documentation checker passes.

## 3. Validation

- [ ] 3.1 Run OpenSpec validation, typecheck, lint, unit tests, and the relevant local integration tests; review the diff and report any environment-dependent checks that cannot run.
