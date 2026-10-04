# P0 compatibility and contract decisions

Checked: 2026-10-05 (Asia/Seoul). This report records decisions and live probe evidence. It does not certify the P0 client/conversation exit gates, which remain unverified below. Independent P1–P4 web implementation can continue under the implementation plan's adapter-specific exception.

## Reproducible evidence

Run `python3 scripts/p0/probe_providers.py` from the repository root. Add `--routes --model` to compute public Seoul landmark routes and run a synthetic structured-output test; these consume normal provider API usage. The script reads the ignored root `.env` without exposing credentials, changes no provider configuration, sends no email/iMessage, and outputs only allowlisted diagnostics. Missing credentials omit their probe, so an empty result is not a successful check. The [redacted captured results](../../scripts/p0/probe-results-2026-10-05.json) are reproducible with the [probe script](../../scripts/p0/probe_providers.py).

| Check | Actual result | What remains unproved |
|---|---|---|
| Supabase Auth health | HTTP 200; Auth v2.197.0 | Sign-in, invitation authorization, application grants |
| OAuth-specific discovery | `/.well-known/oauth-authorization-server/auth/v1`: HTTP 404, `feature_disabled` | OAuth server/DCR must be enabled before client testing |
| Supabase signing keys | JWKS HTTP 200, ES256 | Issued user/client token validation, audience and revoked-grant rejection |
| AgentMail pod application key | HTTP 200, one inbox, configured development inbox visible | Webhook verification, delivery, reply threading, uncertain-send recovery |
| Photon CLI project access | Project matches configured ID; assigned-line list empty | SDK authentication, shared-pool test-user routing and actual delivery |
| Google Routes, Seoul City Hall → Seoul Station | DRIVE and WALK: HTTP 200 with no routes. TRANSIT: one route, latest captured estimate 512 seconds, 1,562 metres | Coverage for other routes/modes, time-specific traffic and estimate freshness |
| OpenAI Responses | HTTP 200, completed; pinned `gpt-4o-mini-2024-07-18` returned exact synthetic 30-minute online-meeting schema | Korean extraction quality, injection resistance, refusals and ranking quality |

Generic OpenID metadata also returned HTTP 200 and advertised code/PKCE S256. That generic endpoint is available while the OAuth server feature is disabled; it cannot establish MCP OAuth readiness. No Calendar grant/refresh token was present in the P0 credential inventory, so actual consent, refresh, Calendar reads/writes and lost-response reconciliation were not exercised.

## Runtime and interface decisions

- Web: React, Vite, TypeScript and npm, hosted on Vercel. The requested shadcn preset `b6rtA2Hmi` uses Nova, olive/green, Inter, large controls and Lucide icons; the web implementation owns installation/version evidence.
- Backend: Supabase PostgreSQL/Auth, Deno Edge Functions, Hono, durable database jobs/queue and Cron. Installed tool versions: Node 24.15.0, Deno 2.9.1, Supabase CLI 2.119.0 and OpenSpec CLI 1.14.0.
- MCP: select the official fetch-compatible `@modelcontextprotocol/server` for stateless Streamable HTTP. Registry checks returned server 2.3.0, `@supabase/server` 1.9.0, middleware 1.0.0 and supabase-js 2.117.2. These are candidate exact pins for the consuming implementation, not claims of installed runtime compatibility. The official Edge guide requires Supabase server ≥1.6 and asymmetric JWT signing. Expose protected-resource discovery before token verification; enabling gateway JWT verification would block that discovery. [Supabase Edge MCP guide](https://supabase.com/docs/guides/ai-tools/byo-mcp).
- OAuth: Supabase OAuth 2.1 with PKCE and DCR, frontend consent, resource/audience validation and application-owned client grants. Grants authorize allowed operations; host approval remains a separate action. The P5 implementation must test issue/refresh/revoke and current grant checks. [OAuth server](https://supabase.com/docs/guides/auth/oauth-server), [MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication), [token security](https://supabase.com/docs/guides/auth/oauth-server/token-security).
- Human confirmation: every host client uses authenticated web confirmation identifying the current proposal version. Model output or a client-supplied `approved` field grants no approval authority. This baseline applies to all seven clients until reliable attributable confirmation has independent evidence.
- Photon: use the direct Spectrum SDK through a narrow Node/Bun messaging bridge in P6. Keep scheduling state and authorization in Supabase. Mastra adds no needed transport benefit. The cloud Spectrum iMessage documentation explicitly requires Node-compatible gRPC and excludes strict worker isolates; Deno's npm support does not establish deployed Edge compatibility. The `@spectrum-ts/imessage` registry version was 12.10.1. A newer advanced-iMessage SDK advertises other transports, but it is a distinct API and has not been selected or validated here. [Spectrum runtime compatibility](https://photon.codes/docs/spectrum-ts/providers/imessage#runtime-compatibility), [advanced SDK source](https://github.com/photon-hq/advanced-imessage-ts).

The Supabase changelog was fetched and scanned. Relevant implementation constraints: use Node ≥22, explicitly grant exposed tables/RPCs with RLS, and review PostgreSQL 15.19/17.11 notes before using legacy encryption or affected indexes. Fresh schema work must not assume old Data API auto-exposure defaults. [Node support](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20), [Data API grants](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), [PostgreSQL changes](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

## Calendar, travel, email and model contracts

Host consent requests Calendar list/read access and event writes separately from requester consent. Select the actual booking calendar and verify its write access; do not replace it silently with `primary`. `calendar.events` supports writes to accessible writable calendars; `calendar.events.owned` would exclude shared booking calendars. Requester grants use only `calendar.events.freebusy` and never enter a host-write adapter. [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth).

Before dispatch, persist one event ID derived from the durable booking identity, using lowercase hexadecimal UUID/hash characters without hyphens (a subset of Google's base32hex alphabet). Preserve the immutable calendar ID/event ID/payload across retries, and GET that identity after an uncertain insert. Verify request identity, current payload and non-cancelled event state before marking booked; duplicate-ID errors are not proof of success. Invitation policy is `sendUpdates=all` for verified recipients. Online meetings initially use a host-supplied HTTPS link; automatic Meet generation is excluded from this implementation decision. [Calendar insert contract](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

Google authorization uses bound state, exact registered callbacks, offline access and encrypted refresh tokens. A missing refresh token cannot be replaced with an empty calendar. Revocation or `invalid_grant` transitions to reconnection. External OAuth apps in Testing generally receive seven-day refresh tokens for Calendar scopes, so production readiness requires the publishing/verification configuration to be inspected. Callback registration and successful human consent remain live gates. [Web OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server), [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2).

Seoul DRIVE/WALK absence is a measured missing estimate, never zero travel. Check both adjacent trips using departure context, travel mode and host buffers. Missing routes require clarification or an explicitly confirmed manual allowance. One successful transit fixture cannot establish regional coverage. [Routes coverage](https://developers.google.com/maps/documentation/routes/coverage).

AgentMail uses the existing dedicated development inbox for controlled tests. P6 can allocate a separate product inbox in the development pod before pilot; provider inbox/thread IDs do not authenticate a sender. Verify the raw body with Svix headers/signing secret, persist deduplicated inbound events before acknowledgment, fetch omitted bodies from the API and reply by parent message ID. Outbound records save an immutable payload and `Idempotency-Key`; sends/replies/forwards use this header, unlike resource creation's `client_id`. Provider send keys expire 24 hours after completion, so an uncertain send beyond that window requires reconciliation/operator review instead of blind resend. Actual contact binding must use verified web continuation. [Webhook verification](https://docs.agentmail.to/webhook-verification), [payload limits](https://www.agentmail.to/docs/webhooks-overview), [idempotency](https://docs.agentmail.to/idempotency).

OpenAI uses Responses `text.format` with `type=json_schema`, `strict=true`, required fields and `additionalProperties=false`, plus `store=false`. Validate parsed values against the domain contract, handle refusal/incomplete/error output, and exclude private event notes/locations unnecessary for extraction. AI cannot authorize approval or booking. The synthetic probe establishes schema/API access for the pinned snapshot only. [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Product defaults to carry into owning changes

These are selected contracts; capability tests and the phase records must prove their implementation.

| Topic | Decision |
|---|---|
| Invitation | Expires after seven days; recipient-bound, atomic single redemption |
| Request expiry | Seven days or the requested window end, whichever is earlier |
| Guest continuation | 256-bit random request-bound credential; store only its hash; maximum 30-day TTL; invalidate on terminal request state |
| Guest recovery | Recover only through verified contact, rotate credential and invalidate the previous token |
| Online meeting | Host-supplied HTTPS link initially; no automatic Meet creation |
| Language | English interface initially; English and Korean extraction inputs, with confirmation of extracted values |
| Host approval | Authenticated human web confirmation bound to exact proposal revision/details |

## Required client matrix and remaining gates

No application MCP endpoint existed when these probes ran. Therefore none of the seven has passed discovery → registration → authorization → tool calls → refresh → revocation → proposal confirmation. Installed software and vendor documentation do not prove a journey.

| Required client | Available evidence | Actual application journey | Confirmation baseline |
|---|---|---|---|
| Dots | Not found in standard `/Applications` or user Applications directories; no tested remote session | Untested; client session unavailable | Authenticated web |
| Muse | macOS app 1.0, build 1070843164 installed | Untested; no application server/client grant | Authenticated web |
| Instinct | Not found in standard app directories; no tested remote session | Untested; client session unavailable | Authenticated web |
| ChatGPT | macOS app 26.930.31730, build 12947 installed | Untested; connector entitlement/settings and browser flow not exercised | Authenticated web |
| Codex | CLI 0.154.0 available; this task runs in Codex App | Untested; no application MCP OAuth flow | Authenticated web |
| Claude | macOS app 1.40609.0 installed | Untested; custom connector flow not exercised | Authenticated web |
| Claude Code | CLI 2.1.252 available | Untested; no application MCP OAuth flow | Authenticated web |

P0's recorded-decision work is available for implementation. Its full live exit evidence remains incomplete: enabled OAuth/DCR plus at least browser/terminal application clients, all seven client matrices, Photon SDK authentication/control conversation, AgentMail verification/threading/uncertain sends, and Google consent/refresh/Calendar read/write. These must stay visible in P0/P5/P6 and release evidence. P1–P4 can proceed with web confirmation and fail-closed provider adapters; mocks cannot mark the dedicated live Calendar M2 gate complete.
