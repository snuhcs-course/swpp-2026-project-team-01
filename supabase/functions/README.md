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

| Variable                                                  | Use                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `APP_ORIGIN`                                              | Exact web origin allowed by CORS and used in callback/email links                          |
| `SUPABASE_URL`                                            | Supabase project endpoint                                                                  |
| `FMAT_SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` | Privileged RPC/Auth client; publishable keys are rejected                                  |
| `WORKER_SECRET`                                           | At least 32 characters; worker endpoint guard                                              |
| `TOKEN_ENCRYPTION_KEY`                                    | Base64-encoded 32-byte AES/HMAC key for credentials, retry tokens and delivery payloads    |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                | OAuth with PKCE and single-use browser-bound state                                         |
| `GOOGLE_ROUTES_API_KEY` or `GOOGLE_MAPS_API_KEY`          | Travel estimates; unavailable estimates remain unresolved                                  |
| `OPENAI_API_KEY`                                          | Optional bounded structured intent extraction; no decision authority                       |
| `OPENAI_MODEL`                                            | Defaults to `gpt-4o-mini-2024-07-18`                                                       |
| `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`                 | Optional fixed-template delivery adapter; inbox ID is an existing authorized sending inbox |
| `TRANSACTIONAL_EMAIL_ENABLED`                             | Defaults false; true permits user-requested verification/recovery emails                   |
| `EXTERNAL_SENDS_ENABLED`                                  | Defaults false; separate switch for booking notification delivery                          |

Contact codes and recovery tokens contain 256 bits of authority and expire after 15 minutes.
Initiation returns only `pending`; verification requires the stored challenge, current contact,
request credential and revision. The provider does not grant verified status. Recovery links use
`#recovery`; verification links use `#verify` and still require the existing protected continuation.
The web app removes those fragments after reading.

Delivery jobs freeze encrypted recipient/body/inbox evidence before send. A provider idempotency key
is derived from the persisted outbox identity and kept on every retry. AgentMail retains send
idempotency for 24 hours; the worker stops retries at 23 hours. Uncertain delivery remains visible
and is never blindly resent after that horizon. Expired/revoked challenges stop sending, preserving
uncertainty if dispatch had started. Disabling delivery suppresses only work that has never been
dispatched.

Google Calendar writes are not registered in the P3 worker. The booking module is integrated only in
its separately gated implementation phase.

Local RPC integration uses fake Google/model providers against the disposable database:

```sh
supabase status -o json > /tmp/fmat-local-status.json
deno run --allow-read=/tmp/fmat-local-status.json --allow-net=127.0.0.1:54321 supabase/functions/_shared/modules/requests/local_integration.ts
```

This creates unique synthetic host/request fixtures locally, verifies proposal selection, private
exceptions, agreement and stale-result rejection, then withdraws the request. The runner rejects
remote project URLs and prints no credentials.
