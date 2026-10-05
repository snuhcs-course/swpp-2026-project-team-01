# Backend runtime

The public `api` function validates host JWTs with Supabase Auth. Guest access uses an unexpired
hashed `X-Request-Token`; all ownership and revision checks run in the service-only `fmat_command`
SQL dispatcher. The `worker` function accepts only `X-Worker-Secret` and passes the claimed worker
identity and lease into each job handler. Each invocation claims one job so a provider operation
cannot spend the leases of queued jobs while waiting. Cron/recovery publishes later work for
subsequent invocations.

Use the same-origin `/api` web proxy for the OAuth browser binding cookie. Register
`APP_ORIGIN/api/google/callback` as the exact Google OAuth redirect. Requester Calendar consent is
optional and reads busy intervals only. Calendar failures require reconnecting; they do not imply
free availability. Public scheduling responses contain candidate start/end values, while travel
context and manual allowances remain host private. Calendar, refresh, travel and optional ranking
calls share an 18-second evaluation deadline. Routes stop after 12 requests; model ranking has its
own 6-second maximum and the same overall deadline. An incomplete Calendar read saves no
availability. Unresolved travel returns `resolve_availability` when no proven candidate can be
selected. Optional ranking receives private preferences and feasible candidate IDs/times only and
must return a complete permutation; invalid/refused output preserves the deterministic ordering.
Every model call uses the durable eight-call request budget, and candidate writes compare the
captured request revision and rules version before persistence.

Host preference exceptions require a separate explicit confirmation and reason bound to the exact
current proposal/rules. A fresh deterministic check runs before saving. These private records change
no hard constraints, requester agreement or host approval.

Required runtime configuration:

| Variable                                                  | Use                                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`                                              | Exact web origin allowed by CORS and used in callback/email links                                                           |
| `SUPABASE_URL`                                            | Supabase project endpoint                                                                                                   |
| `FMAT_SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` | Privileged RPC/Auth client; publishable keys are rejected                                                                   |
| `WORKER_SECRET`                                           | At least 32 characters; worker endpoint guard                                                                               |
| `TOKEN_ENCRYPTION_KEY`                                    | Base64-encoded 32-byte AES/HMAC key for credentials, retry tokens and delivery payloads                                     |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                | OAuth with PKCE and single-use browser-bound state                                                                          |
| `GOOGLE_ROUTES_API_KEY` or `GOOGLE_MAPS_API_KEY`          | Travel estimates; unavailable estimates remain unresolved                                                                   |
| `OPENAI_API_KEY`                                          | Optional bounded structured intent extraction; no decision authority                                                        |
| `OPENAI_MODEL`                                            | Defaults to `gpt-4o-mini-2024-07-18`                                                                                        |
| `CLOUDFLARE_ACCOUNT_ID`                                   | Cloudflare account that owns the onboarded Email Service sending domain                                                     |
| `CLOUDFLARE_EMAIL_API_TOKEN`                              | Runtime Email Sending token for Cloudflare's send API; keep separate from operator credentials                             |
| `CLOUDFLARE_EMAIL_FROM`                                   | `no-reply@findmeatime.com`; verified From address frozen with each new transactional dispatch                               |
| `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`                 | Legacy pending-send compatibility and future managed conversation inboxes/threading                                        |
| `TRANSACTIONAL_EMAIL_ENABLED`                             | Defaults false; true permits user-requested verification/recovery emails through Cloudflare Email Service                  |
| `EXTERNAL_SENDS_ENABLED`                                  | Defaults false; permits Cloudflare booking confirmation emails; approved Calendar inserts still send Google invitations    |

Contact codes and recovery tokens contain 256 bits of authority and expire after 15 minutes.
Initiation returns only `pending`; verification requires the stored challenge, current contact,
request credential and revision. The provider does not grant verified status. Recovery links use
`#recovery`; verification links use `#verify` and still require the existing protected continuation.
The web app removes those fragments after reading.

New delivery jobs freeze encrypted recipient/body plus the Cloudflare account and From address before
send. Cloudflare Email Service does not document a request idempotency key, so once dispatch is
persisted the worker does not replay that send automatically; an ambiguous result remains visible as
uncertain. Historical AgentMail pending sends keep their persisted provider identity and stable key,
with retries stopping at 23 hours before AgentMail's 24-hour idempotency horizon. Expired/revoked
challenges stop sending, preserving uncertainty if dispatch had started. Disabling delivery suppresses
only work that has never been dispatched.

Supabase Auth remains the authentication provider. Configure its custom SMTP transport through
Cloudflare at `smtp.mx.cloudflare.net:465` with implicit TLS, username `api_token`, and the Email
Sending token as the password. Preview the intended configuration, then apply it explicitly:

```sh
node --env-file=.env scripts/configure-email-smtp.mjs
node --env-file=.env scripts/configure-email-smtp.mjs --apply
```

`--apply` requires `SUPABASE_ACCESS_TOKEN`. This is an operator-only Management API credential, not a
function runtime secret. See [Cloudflare SMTP](https://developers.cloudflare.com/email-service/api/send-emails/smtp/)
and [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

The P4 worker registers booking and reconciliation jobs. SQL reserves a host and freezes the event
ID, payload, proposal version, provider account and calendar before dispatch. Final fresh validation
reads the selected conflict calendars plus the frozen booking destination, checks its current
writer/owner permission, intersects requester busy times and applies travel context. Local confirmed
receipts also block conflicts while Google reads catch up. Normal evaluation and booking validation
use the same receipt merge; explicit SQL meeting mode prevents online links from implying physical
whereabouts. SQL compares fresh credential timestamps/provider account, request/rules versions and
the job lease before permitting the exact frozen write. Token refresh uses the captured credential
timestamp/account as a compare-and-swap guard and re-reads stored metadata afterward.

Only the authenticated host approval route adds `confirmationSource: authenticated_web`, and it
requires explicit confirmation of the exact proposal version. Google insertion uses
`sendUpdates=all`, the approved attendee set and the saved event ID. An uncertain write retains its
reservation and reconciles with GET of that same calendar/event; no replacement ID is generated. The
reconciliation adapter validates association and all frozen visible event fields before recording
confirmation. Booking notifications use independent delivery jobs and remain off unless
`EXTERNAL_SENDS_ENABLED=true`.

Local RPC integration uses fake Google/model providers against the disposable database:

```sh
supabase status -o json > /tmp/fmat-local-status.json
deno run --allow-read=/tmp/fmat-local-status.json --allow-net=127.0.0.1:54321 supabase/functions/_shared/modules/requests/local_integration.ts
```

This creates unique synthetic host/request fixtures locally, verifies proposal selection, private
exceptions, agreement and stale-result rejection, then withdraws the request. The runner rejects
remote project URLs and prints no credentials.

