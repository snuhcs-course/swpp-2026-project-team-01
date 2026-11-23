# Proposal

Tracking issues: #360, #365, #366, #372

## Why

Team QA on findmeatime.com on 2026-11-23 found four places where the signed-in host's web pages look wrong or do nothing:

- After a linked host connects Google Calendar from Thyme's Calendar link, `/app` says "Your iMessage is connected." again, as if the calendar step did nothing (#360).
- In the Dashboard's Week view, moving to the next or previous week replaces the whole grid with "Loading your calendar…", even for a week just seen (#365).
- The wordmark on the signed-in host pages is plain text, or on the link step leads to the public landing, instead of opening the workspace at `/app` (#366).
- Every visit to `/app` and `/app/notes` first streams a "Welcome to Thyme / Loading your workspace…" screen in the sign-in layout, so for a moment the host seems to be sent back to sign-in (#372).

## What Changes

- The sign-in callback for a sign-in begun at Thyme's Calendar link returns to `/app?calendar=connected` when the host's Google grant can use Calendar, and to `/app` otherwise. The link step then says "Google Calendar is connected." and that setup continues in the linked app, with the same **Open** action. The parameter only changes words: the callback sets it after checking the grant.
- The Dashboard keeps its grid while a period loads and shows "Loading events…" over the event area. Loaded periods are kept for the visit and shown at once when revisited while they refresh; the periods either side are fetched ahead; each answer is kept under its own range, so a late answer never replaces the period on screen.
- The wordmark on every signed-in host page, and the logo on the link step, links to `/app`. Public pages keep their link to `/`.
- The `/app` and `/app/notes` loading fallback is the page background with a status line that screen readers hear at once and that appears on screen only after 600ms. The pages no longer open the setup session when they do not show it (`/app/notes`, and `/app` when it shows the Dashboard).

## Capabilities

### Modified Capabilities

- `chat-workspaces`: the single host workspace states the wordmark, the loading state and the return from Thyme's Calendar link; the host calendar Dashboard states how period navigation loads.

## Impact

`lib/server/google-sign-in.ts`, `lib/server/web-session.ts`, `apps/web/app/app/page.tsx`, `apps/web/app/app/notes/page.tsx`, `apps/web/app/_components/ink/link-step.tsx`, `ink/copy.ts`, `ink/chrome.tsx`, `host-dashboard.tsx` with the new `host-dashboard-data.ts`, the new `host-wordmark.tsx` and `workspace-loading.tsx`, `host-workspace.tsx`, `host/host-requests.tsx`, `sign-in-card.tsx` and `globals.css`. The open `host-imessage-channel` change's D19 and its "Back from Google" scenario now name the `?calendar=connected` return. No schema change.
