# Proposal

Tracking issue: #407

## Why

A host who signs in with Google during iMessage onboarding is asked in iMessage to connect Google Calendar again, although the sign-in already asked for the Calendar scopes. Plain sign-in sends `access_type=offline` without `prompt=consent`, and Google returns a refresh token only when it shows the consent screen. A Google account that authorized this OAuth client before (a deleted earlier account, a teammate's test, another environment on the same client) skips the screen, so the new host account stores no refresh token, the grant is not usable ([`calendarUsable`](../../../lib/server/readiness.ts)), and the welcome sends the Calendar link (`host-imessage-channel` D19). The welcome also gives no reason, so the second ask looks like a bug. The same welcome follows when the host unticked the Calendar boxes, or when Google later rejected the stored token (for example after seven days while the OAuth app is in Testing).

## What Changes

- **Consent on the onboarding sign-in.** A Google sign-in that links an iMessage conversation (the iMessage start's browser cookie, the continuation cookie from Thyme's sign-in link, or `return=imessage`) asks Google to show the consent screen and keep earlier grants (`prompt=consent`, `include_granted_scopes=true`), as **Connect Google Calendar** already does. Google then returns a refresh token, so a host who ticks the Calendar boxes is not asked again in iMessage. An identity-only sign-in (`?calendar=0`) is unchanged.
- **Lasting access after any sign-in.** A plain Google sign-in that asks for Calendar without the consent screen records that in a cookie. When its callback finds every Calendar scope granted but no usable grant (no refresh token, or a token Google has rejected), it goes straight on to the renewed Calendar consent (`/auth/sign-in?consent=calendar`), keeping the recorded return, instead of landing on `/app`, where setup and later the messenger welcome would ask for Calendar again. That covers a host who signs in on the web first and links a messenger from `/app`. The renewed consent's own callback never redirects again, and unticked Calendar boxes are left as the host's choice.
- **The welcome says why.** When the linked host has a Google grant that still cannot use Calendar, the welcome adds one line naming the cause read from the stored grant: Google did not confirm the Calendar permission (the boxes were unticked, or the granted scopes could not be read), Google gave no lasting access (no refresh token), or the access ended (Google rejected the token). A host with no grant at all is asked as before, with no cause line.

## Decisions

Worked out in the session that implemented issue #407, from the two fixes the issue proposed.

| # | Decision | Choice |
|---|---|---|
| D1 | Where the second ask is avoided | Ask for consent on every sign-in that links an iMessage conversation. Who signs in is known only in the callback, so the sign-in cannot be limited to hosts without a usable grant; a host who already had one sees Google's consent screen once more during onboarding, which costs one tap. A start or continuation cookie left from an earlier attempt also triggers it on an unrelated sign-in in the same browser; the callback claims that cookie anyway, and the cost is one extra Google screen. Rejected: redirecting from the callback to a second Calendar consent in the same browser before the welcome, which needs the start and continuation cookies to survive a second round trip and defers the binding, and still shows a second Google screen |
| D2 | What the welcome says | The cause from the stored grant: `invalidated_at` set → access ended; no refresh token → no lasting access; a token without every Calendar scope → Google did not confirm the permission, worded so it stays true when the scopes could not be read, which the stored row cannot tell from unticked boxes. No grant row → no cause line. Rejected: one generic reason, which cannot tell a declined permission from Google's missing token; "permission was not granted", untrue after a failed scope read |
| D3 | The other sign-ins | A plain sign-in that asked for Calendar without the consent screen sets `fmat_auth_consent=asked` (HTTP-only, `/auth`, ten minutes). Its callback, once the grant is recorded, redirects to `/auth/sign-in?consent=calendar` with the recorded return when every Calendar scope is granted but `calendarUsable` is false, so only a host who would otherwise be asked again sees a second Google screen, and the renewed sign-in clears the cookie so it never repeats. Unticked scopes are not asked again. Rejected: `prompt=consent` on every sign-in, which shows the consent screen to every returning host; a callback query marker in `redirectTo`, which Supabase's redirect allow-list may not match |

The OAuth app's publishing status (the issue's third case) is an operator check in the Google Cloud console, not a code change; the welcome's "ended" line covers the effect.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-workspaces`: a sign-in that skipped the consent screen and left no lasting Calendar access goes on to the renewed consent (D3).
- `host-imessage-channel` (unarchived, in [`host-imessage-channel`](../archive/2026-11-24-host-imessage-channel/proposal.md)): the onboarding sign-in asks for consent, and the welcome says why it asks for Calendar again. The capability exists only in unarchived changes, so this change adds its requirement as ADDED and is archived after them.

## Impact

- `lib/server/google-sign-in.ts` (`createGoogleSignInHandler`, `createGoogleCallbackHandler`, `CONSENT_COOKIE`), `lib/server/imessage-links.ts` (`linkedText`, `LINK_TEXTS.welcomeCalendar`, `CALENDAR_ASK_CAUSES`).
- No schema change.
- Documents: provider setup, page list, decision log, testing baseline, and their `ko/` mirrors.
