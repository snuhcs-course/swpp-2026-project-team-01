# Proposal

Tracking issue: #183

## Why

A signed-in host who opens another host's booking link is treated like a stranger: the page says "You need no account", the identity card asks them to type the name and email their account already holds (or to go through Google again), a request they already started with that host can be found only from `/app`, and the guest page offers no way back to their own workspace. The 2026-11-08 kickoff assigned "host and guest roles in one session".

What already works, and stays as it is: the guest's Google consent creates no account session and leaves the host's session cookie untouched; a request identified manually while signed in is linked to the account (`recordHostSessionMatch`, #210); a request linked by a verified Google subject offers **Use your host settings for this request** ([guest-flow-completion design 6](../../guest-flow-completion/design.md#6-host-profile-for-a-guest-who-is-a-host)); and `/app` Requests lists sent requests next to received ones and opens a sent one under its private link ([request-dashboard](../../request-dashboard/proposal.md)).

## What Changes

- **Continue as the account.** On another host's booking link, the identity card of a signed-in, active account offers **Continue as {name}** first. It identifies the draft with the account's display name and the Google address it signed in with, which counts as the confirmed contact, settles the Calendar step as skipped, and links the request to the account in the same transaction. **Continue with Google** and **Continue without Google** stay available.
- **Resume.** The landing of that link tells the account it is signed in, and when the account already has an open request with this host whose private link is live, it offers **Continue your request**, opening that request's guest page.
- **Back to the workspace.** The guest page of a request linked to the signed-in account shows **Back to your workspace**, a plain link to `/app`.
- **Own link.** A host who opens their own booking link is told it is their own, with a link back to `/app`; the guest start stays usable for previewing.

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Identity source | The account's name is its host display name (settings, else account); the email is `google_identities.email`, the address Google verified at sign-in, so it is stored as the confirmed contact. Rejected: reading the address from the browser or the typed form, which proves nothing |
| D2 | Authority | A new requester operation `request.identify_account` runs only when the commands route verifies a Supabase session for an active account that is not the request's host; the booking identifier stays the request's only credential, and the session grants nothing on the request beyond this identification. Rejected: a session-wide guest role, which would let the account read requests other than the one it holds a link for |
| D3 | Resume lookup | Only requests already linked to the account (`requester_host_profiles`) that are open and not drafts, with a live link, newest first; the link is opened from its sealed copy only for that account. Rejected: matching by contact email |

## Capabilities

### Modified Capabilities

- `meeting-requests`: a signed-in account can start, resume and leave a guest request with the same account.

## Impact

`lib/server/request-start.ts` and `lib/server/requester-host-profiles.ts` (identification by account, the visitor lookup), the requester commands route, the booking link and guest pages, the guest flow document, and tests. No schema migration, provider grant or new route.
