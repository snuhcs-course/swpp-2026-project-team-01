# Design

## 1. The return from Thyme's Calendar link (#360)

The callback already knows the sign-in came from the Calendar link (the `imessage` return cookie, `host-imessage-channel` D19). After resuming the conversation it reads the host's grant with `calendarUsable`, the predicate readiness uses, and returns to `/app?calendar=connected` only when it holds. The sign-in link in Thyme's reply to a code from the iMessage start records the same return but carries a continuation token; that sign-in still ends in **Confirm and link**, so it never sets the flag. `/app` passes the flag to the link step, which changes the heading and lede of its linked screen and nothing else, and drops it from the address so a reload does not repeat it. A host who unchecked Calendar on the consent screen returns to plain `/app`, as before, and Thyme's message in the conversation, which never claims the grant, asks again.

Rejected: telling the link step from the link status alone, which cannot tell a Calendar return from any other visit; a cookie, which a later visit would read again.

## 2. Dashboard periods (#365)

`host-dashboard-data.ts` holds the period arithmetic and a per-visit cache keyed by the requested range. The component renders the grid from the anchor alone and reads events with `peek(range)`, so whatever range is on screen shows only its own answer: out-of-order answers are filed under their own range. A period with an answer shows it while a fresh request refreshes it; a period without one shows "Loading events…" over the empty grid. The previous and next periods are fetched once each, ahead, and their failures are ignored. One request per range is in flight at a time, an answer under 30 seconds old is reused without a new request so quick navigation does not list Google Calendar at every step, and a failure is not cached.

Rejected: a client data library (SWR, React Query), which the app does not use elsewhere, for one screen.

## 3. Wordmark and loading fallback (#366, #372)

`HostWordmark` is the signed-in pages' `<h1>` holding a `.wordmark-lockup` link to `/app`, so the heading and its accessible name stay "Find Me a Time". The ink `Brand` takes an `href`, used as `/app` by the link step only.

The Suspense boundary stays, since `cacheComponents` needs request-time data inside it. Its fallback is now `WorkspaceLoading`, the workspace background with a `role="status"` line delayed by CSS (600ms, no fade under reduced motion). DESIGN.md forbids animating the mark as a loading indicator, so the line is text. `openHostWorkspace` returns the standing with an `openSetupSession` the page calls only when it renders the setup conversation.
