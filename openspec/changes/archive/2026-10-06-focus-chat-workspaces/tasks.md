# Tasks

## 1. Host workspace

- [x] 1.1 Replace the permanent sidebar with a compact, keyboard-operable workspace menu; verify setup and inbox navigation plus Escape/focus at desktop and phone widths with `npm run test:workspace`.
- [x] 1.2 Keep setup progress and exact settings in the chat/settings surfaces; verify admission, ready link, calendar controls, and message submission with `npm run test:setup`.
- [x] 1.3 Update the host setup UX documentation and verify it describes the actual menu, transcript, and settings control.

## 2. Request conversations

- [x] 2.1 Center requester intake and request detail on the transcript; verify request creation, revision-bound review, and agreement at desktop and phone widths with `npm run test:requester`.
- [x] 2.2 Replace inbox dashboard cards with conversation artifacts and add a shared/private host discussion switch; verify inbox search, private isolation, approval, and phone overflow with `npm run test:workspace` and `npm run test:browser`.
- [x] 2.3 Update the interface and request runtime documentation; verify they describe the current layout and preserve the approval/privacy boundaries.

## 3. Integration

- [x] 3.1 Run web lint, typecheck, build, browser fixtures, and strict OpenSpec validation; review the mobile and desktop screenshots for overflow and composer reachability.
