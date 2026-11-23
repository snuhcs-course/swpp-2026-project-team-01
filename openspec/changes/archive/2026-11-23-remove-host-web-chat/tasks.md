# Tasks

## Implementation

- [x] Refuse a `request` scope on `/api/chat/messages`, `/api/chat/state`, `/api/chat/events` and `/api/chat/recover` with `400 request_scope_unsupported`, and serve only the setup discussion.
- [x] Remove the request parameter from the browser discussion client, `useHostDiscussion` and the recovery helpers.
- [x] Check that the messenger offers each kept web control, and record the gaps (weekly-limit waiver, trip estimate) for #327.
- [x] Remove the setup chat from `/app`, the `/api/chat` routes and the browser host-discussion client; point an incomplete host to the messenger, and record the paths that have no messenger equivalent yet.

## Tests

- [x] Unit-test the route refusals and the setup-only message path (`lib/server/chat-routes.test.ts`).
- [x] Open the review discussion in `tests/integration/host-review.test.ts` as a messenger does, and assert that the web routes refuse the request scope.
- [x] Remove or rewrite the browser tests of the web chat and the live-model run.
- [ ] Run `npm run test:integration` and `npm run test:e2e` on `main` after merging (the repository owner runs them).

## Documentation

- [x] Update the testing baseline rows H03 (W-2, W-5, W-6) and M01 (W-H1), and the documents that described a web request discussion.
- [x] Regenerate the Korean mirrors of the changed documents.
