# Proposal

Tracking issue: #407

## Why

A host who signs in with Google during iMessage onboarding is asked in iMessage to connect Google Calendar again, although the sign-in already asked for the Calendar scopes. Plain sign-in sends `access_type=offline` without `prompt=consent`, and Google returns a refresh token only when it shows the consent screen. A Google account that authorized this OAuth client before (a deleted earlier account, a teammate's test, another environment on the same client) skips the screen, so the new host account stores no refresh token, the grant is not usable ([`calendarUsable`](../../../lib/server/readiness.ts)), and the welcome sends the Calendar link (`host-imessage-channel` D19). The welcome also gives no reason, so the second ask looks like a bug. The same welcome follows when the host unticked the Calendar boxes, or when Google later rejected the stored token (for example after seven days while the OAuth app is in Testing).

## What Changes

- **Consent on the onboarding sign-in.** A Google sign-in that links an iMessage conversation (the iMessage start's browser cookie, the continuation cookie from Thyme's sign-in link, or `return=imessage`) asks Google to show the consent screen and keep earlier grants (`prompt=consent`, `include_granted_scopes=true`), as **Connect Google Calendar** already does. Google then returns a refresh token, so a host who ticks the Calendar boxes is not asked again in iMessage. An identity-only sign-in (`?calendar=0`) is unchanged.
- **The welcome says why.** When the linked host has a Google grant that still cannot use Calendar, the welcome adds one line naming the cause read from the stored grant: the Calendar permission was not granted (the boxes were unticked), Google gave no lasting access (no refresh token), or the access ended (Google rejected the token). A host with no grant at all is asked as before, with no cause line.

## Decisions

Worked out in the session that implemented issue #407, from the two fixes the issue proposed.

| # | Decision | Choice |
|---|---|---|
| D1 | Where the second ask is avoided | Ask for consent on every sign-in that links an iMessage conversation. Who signs in is known only in the callback, so the sign-in cannot be limited to hosts without a usable grant; a host who already had one sees Google's consent screen once more during onboarding, which costs one tap. Rejected: redirecting from the callback to a second Calendar consent in the same browser before the welcome, which needs the start and continuation cookies to survive a second round trip and defers the binding, and still shows a second Google screen |
| D2 | What the welcome says | The cause from the stored grant: `invalidated_at` set → access ended; no refresh token → no lasting access; a token without every Calendar scope → permission not granted. No grant row → no cause line. Rejected: one generic reason, which cannot tell a declined permission from Google's missing token |

The OAuth app's publishing status (the issue's third case) is an operator check in the Google Cloud console, not a code change; the welcome's "ended" line covers the effect.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `host-imessage-channel` (unarchived, in [`host-imessage-channel`](../host-imessage-channel/proposal.md)): the onboarding sign-in asks for consent, and the welcome says why it asks for Calendar again. The capability exists only in unarchived changes, so this change adds its requirement as ADDED and is archived after them.

## Impact

- `lib/server/google-sign-in.ts` (`createGoogleSignInHandler`), `lib/server/imessage-links.ts` (`linkedText`, `LINK_TEXTS.welcomeCalendar`, `CALENDAR_ASK_CAUSES`).
- No schema change.
- Documents: provider setup, page list, decision log, and their `ko/` mirrors.
