# Tasks

## Calendar return (#360)

- [x] Return a Calendar-link sign-in to `/app?calendar=connected` when the grant is usable, and show the Calendar-connected words on the link step.
- [x] Cover both returns in the Google sign-in integration tests and the words in the copy unit tests.

## Dashboard (#365)

- [x] Keep the grid while a period loads, cache loaded periods, prefetch neighbours and read only the shown range's answer.
- [x] Cover the ranges, the cache, prefetching, failures and out-of-order answers in unit tests.

## Wordmark and loading (#366, #372)

- [x] Link the wordmark on signed-in host pages and the link step's logo to `/app`.
- [x] Replace the sign-in-layout fallback with the quiet `WorkspaceLoading` status, and open the setup session only where it is shown.
- [x] Cover the wordmark, the logo and the fallback in unit tests.

## Documents

- [x] Update the open `host-imessage-channel` change (D19 and "Back from Google"), the host onboarding flow (H4) and DESIGN.md's host workspace screen.
- [x] Regenerate the Korean mirrors of the changed documents.
