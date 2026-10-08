# Design

## Context

See [proposal.md](proposal.md). Host setup and request continuation are separate principals; callback security must not depend on client-provided actor identity.

Follow the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md): root `agent/`, Next.js in `apps/web/`, shared contracts and authorized server operations in root `lib/`, and separately built eve/web services composed through root `vercel.ts`. The reconstruction target is `https://release.findmeatime.com` with Supabase project `mriseqztcwmezvtawnbo`. Runtime and provider compatibility require fresh verification.

## Goals / Non-Goals

**Goals:** least-scope grant boundaries, encrypted server credentials, resumable consent, honest read/refresh failures.

**Non-Goals:** guest event writes, automatic calendar destination fallback, and Calendar event creation before booking implementation.

## Guest identity and timezone

Implement optional Google identity separately from Google Calendar authorization. Resolve the identity adapter and callback route before coding; request identity claims only for the sign-in action, and free/busy access only on the explicit Calendar action. Bind both flows to the initiating browser and authorized request or bounded intake draft. Validate subject and verified email server-side, preserve name/email review, and verify manual or alternate addresses before trusted recipient/recovery use. A matching email or successful login does not merge histories, claim a request, admit a host or agree to a meeting. Preserve skip/manual paths and do not require a product account.

Initialize the displayed timezone from browser IANA context unless the guest already chose one; expose a selector without an extra confirmation question. Persist explicit choice across callbacks/reload. Ask only when timezone is absent/conflicting or local-time/travel meaning is ambiguous. Display conversion preserves candidate instants; changed scheduling constraints trigger re-evaluation. See [guest intake](../../../documentations/technical_specification/02_frontend_architecture.md#guided-guest-intake).

## Decisions

- Persist expiring single-use OAuth state with authorized actor/request, PKCE verifier where supported, exact return destination, and a random HttpOnly Secure binding cookie. Start consent under current credentials; consume state atomically after validating browser binding. Only allow service-defined return URLs.
- Host scopes support calendar list/read and events on accessible writable calendars; requester scopes provide free/busy plus calendar-list metadata for explicit selection, without event details or writes. Store grant kind and subject/request ID explicitly so requester tokens cannot reach write adapters.
- Use offline consent and AES-GCM token encryption with a dedicated server key separate from rows. Never return ciphertext or plaintext tokens in DTOs; refresh with bounded deadlines and reject `invalid_grant` with reconnection. Missing refresh material remains incomplete.
- Persist selected conflict calendar IDs and booking ID after checking current list/accessRole. Recheck writable destination before booking dispatch. Do not silently substitute `primary`.
- Disconnect removes local refresh material and revokes pending dependent authority. Requester access expires with request/token closure. Optional denial permits explicit manual/agent availability; a failed connected read pauses evaluation until the owner makes that replacement explicit.

## Risks / Trade-offs

- [Cross-origin callback cookie policy] → Use one server-origin OAuth start/callback flow and exercise the actual browser redirects.
- [Google Testing refresh expiry] → Document publishing/verification and show reconnect actions; local tests cannot certify production consent.
- [Encryption key loss/rotation] → Preserve separately managed versioned keys and fail closed rather than treating undecryptable grants as empty calendars.

## Migration Plan

Add grants and consent-state schema, generate/review migrations, deploy callback endpoint, register its exact URL, and test controlled host/requester consent. Configure web allowed origins and Supabase Auth URLs. Rollback preserves grant isolation and clears invalid pending states without exposing tokens.

## Implemented consent boundary (2026-10-07)

`fmat_calendar_consent` is callable only by the service role and derives authority from original verified credentials. It locks current authority before consuming/saving single-use consent, fences older attempts on restart/disconnect, and checks revocation again after the external exchange. Host setup returns to `/app`; request consent returns to its exact `/booking/[bookingId]`. The browser receives an authorization URL and safe status only. The official Google SDK verifies signed OIDC claims; PKCE and nonce bind the exchange. AES-GCM authenticated context binds secrets to state or principal. The new desired schema and fourteenth migration preserve historical migrations.

Local database, real-Auth/integration and browser fixtures verify consent denial/replay/isolation and revocation during exchange. Exact release/local callbacks are registered. Host listing, selection and refresh are implemented as described below. Requester availability reads, refresh/recovery and explicit manual replacement are implemented as described below. Guest identity-only entry and live Google acceptance remain unfinished.

## Host calendar choices (2026-10-07)

A service-only Calendar-access RPC checks the current admitted host session before reading encrypted credentials and again after provider calls. A per-connection UUID changes on consent save; setup revision fences concurrent choices, and ciphertext comparison fences concurrent refresh. Current Calendar-list metadata is fetched again on confirmation. Conflict calendars may expose free/busy only; booking requires owner/writer access, including Google’s writer-without-private-access role. No destination is inferred from primary status. The browser explicitly confirms choices and receives only metadata, selection state and revisions. Listing is bounded to ten pages/15 seconds; refresh to ten seconds with retries disabled. Provider failures remain actionable failures, never empty-calendar substitutes.

## Requester availability and recovery (2026-10-07)

FR-36 requires calendar selection. Requester consent therefore requests `calendar.events.freebusy` for availability on accessible calendars and `calendar.calendarlist.readonly` for the chooser, alongside identity scopes. The earlier `calendar.freebusy`-only bundle cannot list calendars and requires reconnection. Google’s [scope definitions](https://developers.google.com/workspace/calendar/api/auth) and [free/busy endpoint](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) document these narrow permissions. Calendar metadata is returned only to that requester’s authorized browser; raw busy intervals stay inside the server evaluator boundary and no event-detail endpoint is used.

The request records whether availability depends on Calendar or explicit manual windows. Disconnect alone preserves the Calendar dependency. Explicit manual confirmation saves normalized windows/timezone, removes credentials and invalidates prior proposals/decisions atomically. A failed required read records a pause and invalidates scheduling results; missing calendars, provider errors and partial ranges never become free time. Every result is fenced against request revision, grant generation, closure, token rotation and manual replacement. Successful retry performs a fresh provider read. Closure or continuation-token revocation/rotation deletes encrypted guest credentials; expired authority is rejected even before cleanup.

Free/busy reads allow at most 50 selected calendars and 30 windows (each at most 31 days), with one 15-second overall deadline, a four-MiB response cap per range, no redirects/retries, exact response coverage and per-calendar success required. Overlapping/adjacent busy intervals are merged and clipped to the requested windows. Manual wall-clock input uses the selected IANA zone with Temporal’s reject disambiguation, so repeated or nonexistent DST times require correction. No check or manual confirmation creates agreement or host approval.

## Requester identity adapter (2026-10-08)

Use a separate identity-only adapter with the existing registered `/connections/google/callback` URI. The forthcoming callback dispatcher must identify the identity flow by its dedicated browser binding cookie and state record; it must never fall back to Calendar consent after an identity-state failure. Start under an authorized intake token or current request credential. Save the bounded intake draft and explicit timezone before redirect, and bind state to that exact handle/token or request/revision. Consume state once before exchanging a code, then recheck current authority before storing proof. Account switching supersedes earlier pending flows. The service-only state adapter now enforces these bindings; the browser dispatcher and controls now use the same boundary.

`GoogleRequesterIdentity` requests only `openid email profile`, online access, account selection, PKCE and nonce, without incremental Calendar scopes. It uses the existing official Google SDK to check signed issuer/audience/time claims and additionally enforces nonce and strict current expiry. Its HTTP interceptor disables retries after the SDK merges its own retry options, rejects redirects and bounds each network call to ten seconds. Only subject, bounded display name, normalized email and contact-proof eligibility leave the adapter; provider tokens are discarded and no Supabase account/session is created.

Google is authoritative for Gmail addresses and verified hosted-domain claims. For a third-party email without `hd`, even `email_verified=true` may reflect historical ownership: prefill that address but require our current email-code proof before attendee/recovery use. Do not infer hosted-domain authority from the email suffix. The request's current chosen email must equal the verified identity email before a bound save can mark contact verified. A manually changed address remains unverified. This follows [Google's backend verification guidance](https://developers.google.com/identity/sign-in/web/backend-auth) and [OIDC claims](https://developers.google.com/identity/openid-connect/openid-connect).

The provider and durable state adapters are implemented. Callback dispatch and browser controls are implemented and tested with signed provider fixtures. Live acceptance and the remaining timezone/Calendar journeys remain open.

### Durable identity state

Private `requester_identity_flows` stores an encrypted PKCE/nonce secret, hashed state/binding, exact intake token/handle or guest token/request, request revision, bounded draft, consumed/save markers and supersession. Pending OAuth expires in ten minutes; drafts remain recoverable for one day under the same authority; saved identity can supply contact proof for one hour. Ten starts per scope per ten minutes bounds retries. Starting again or skipping invalidates old callbacks and identity selection. Consume clears the encrypted verifier and never repeats the provider exchange; an uncertain database save can replay only its identical saved identity.

Intake commands share the existing intake advisory lock, and guest commands lock the request before identity scope/flow locks. Authority and wall-clock expiry are checked after lock acquisition and again after the external exchange. Submitted/rotated intake tokens cannot become unused identity drafts. Public intake creation applies eligible proof in the same transaction only for the exact reviewed recipient; an alternate address remains unverified. Existing requests require an explicit current-revision proof action for the matching recipient. Proof updates audit/history without agreement, approval, Calendar grant or account creation. Consumed proof cannot reverify a subsequently invalidated contact. Browser callback lookup requires both random state and the separate binding cookie before disclosing only its fixed target, then consume requires current target authority.

### Browser identity controls

`/api/browser/requester-identity/{state,start,skip,apply}` derives authority only from HttpOnly intake/request cookies and checks the current intake attempt identifier. POSTs use the existing same-origin boundary. The browser-visible OAuth state has an `identity.` prefix; the registered Google callback dispatches it exclusively to identity handling and removes the prefix before state lookup. A dedicated expiring binding cookie and current target cookie are both required. Invalid identity callbacks never fall through to host or Calendar handling. Safe errors return to the known original target, or the landing page when no target can be verified; provider text and arbitrary redirects are discarded.

Intake offers Google and manual entry together, saves the current draft before consent, restores purpose/timezone on return, prefills identity and allows name/recipient edits. Manual skip clears pending identity authority. An identity-state read failure leaves manual intake usable. Existing requests show the selected Google email inside the contact-verification card and require **Use verified Google email** for a matching recipient; a different address must first be reviewed through request details. Unknown proof responses retain the same revision/email for explicit retry. Codes, provider credentials and identities are kept out of browser storage and chat.

The browser fixture intercepts only Google token/certificate HTTP responses. The built app validates PKCE and a real RSA-signed JWT through the SDK, then consumes/saves actual database state. Next bundles the SDK separately, so prototype monkey-patching was replaced by this network-boundary fixture; production has no fixture switch. The identity adapter explicitly supplies native fetch to its bounded SDK transporter.
