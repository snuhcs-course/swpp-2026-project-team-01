# Photon bridge

This Node 24 service connects Photon iMessage transport to the private host-setup command boundary. It contains no scheduling or database logic. The backend resolves every sender through a current private-channel link and owns inbound deduplication, turn ordering, setup mutations, and durable outbound intent state.

A heartbeat watchdog closes stalled connections, and a bounded reconnect loop replays from the backend checkpoint after errors or normal stream termination. Shutdown aborts reconnect delays and drains active inbound handling.

The bridge consumes Photon’s durable event log from the backend’s last committed sequence and then opens the live subscription. It accepts only normal text from a one-participant private iMessage chat whose sender, service, and chat identity all agree. Groups, forwarded messages, mismatched identities, and malformed events are checkpointed without forwarding their body. Provider message IDs are sent to the backend for durable replay handling.

Outbound dispatch follows this state sequence:

1. The backend persists the reply and stable `clientMessageId`, then exposes a `dispatch` claim.
2. The bridge rechecks the active link and exact conversation/client identity.
3. It calls Photon once with SDK retries and automatic idempotency disabled.
4. A bound response records `accepted` or `delivered`. A missing or invalid response records `uncertain`.
5. An uncertain intent can only produce a `reconcile` claim. Reconciliation reads that exact conversation after the intent time; it never calls send. Only a previously persisted provider message ID can confirm a history entry. Photon history does not expose the client message ID; text alone cannot bind a lost acknowledgement, so those intents remain uncertain and require operator review. Zero or multiple matching messages and incomplete history also remain uncertain.

## Configuration

`PHOTON_BRIDGE_ENABLED` defaults to `false`. In that state `/health` returns live and `/ready` returns 503, giving the website an honest fallback while no iMessage runtime is configured.

Enabled operation requires:

- `FMAT_API_URL`: HTTPS backend API origin/base path (plain HTTP is accepted only for loopback development).
- `PHOTON_BRIDGE_SECRET`: dedicated internal bearer secret of at least 32 characters shared only with the backend. Reusing worker, Supabase, or Photon credentials is rejected.
- `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET`: existing Photon project credentials.
- `PORT`: optional, defaults to `8080`.
- `FMAT_PHOTON_OPERATION_TIMEOUT_MS`, `FMAT_PHOTON_OUTBOUND_POLL_MS`, `FMAT_PHOTON_HEARTBEAT_STALE_MS`, `FMAT_PHOTON_RECONNECT_MIN_MS`, and `FMAT_PHOTON_RECONNECT_MAX_MS`: optional bounded runtime tuning.

Do not place secrets in an image or committed environment file. Inject them through the runtime’s secret manager. The bridge authenticates only to `/internal/setup/imessage/*`; the backend must reject the secret everywhere else and must never accept a host ID from this service.

## Run and verify

```sh
npm ci
npm run check
docker build -t fmat-photon-bridge .
docker run --rm -p 8080:8080 fmat-photon-bridge
```

With the default disabled state, check `GET /health` for liveness and expect `GET /ready` to return 503. The container runs as the unprivileged `node` user and handles `SIGTERM`/`SIGINT` by stopping polls, closing the provider, and closing the health listener.

## Deployment status

The production website runs on Vercel and the backend runs on Supabase. The Fly app is reserved, but the bridge has no running production server. A new persistent server still needs deployment, secret injection, restart recovery and HTTP health verification before enabling iMessage setup. Website setup remains available while the bridge is disabled or unavailable. [CLI and local-container preparation evidence](../../scripts/p0/fly-bridge-preparation-2026-10-05.json).

No live Photon messages are sent by the test suite. Tests use provider-shaped fixtures for restart replay, serialized inbound processing, sender/service/chat checks, group rejection, unlink races, stable outbound identity, lost acknowledgements, and reconciliation without resend.

Start only one bridge process per Photon project; the durable database claims still fence concurrent dispatch, but one owner avoids cursor and subscription contention. Do not reuse the repository root `.env` wholesale in the bridge container.

## Fly.io CLI setup (app reserved, server not deployed)

The user selected the official Fly CLI setup on October 5, 2026. The app name `fmat-photon-bridge` is reserved in the authenticated `personal` organization; it has no Machines. `fly.toml` configures the proposed server in Tokyo (`nrt`), with one shared CPU, 512 MB RAM, restart policy `always`, autostop disabled, and `min_machines_running = 1`. This runs the existing Node Docker container continuously for outbound Photon gRPC and backend HTTPS connections. Public HTTP exposes only the existing `/health` and `/ready` status responses. No volume, database, dedicated IPv4, or custom DNS record is required. [Fly configuration](https://docs.fly.io/reference/configuration)

`/ready` is the Fly health check: it returns 503 when disabled or disconnected, including a stale heartbeat. `/health` reports process liveness and can return 200 while disabled. Failed checks do not automatically restart a Machine; process exits use the restart policy, and transport stalls use the bridge's watchdog/reconnect loop. A singleton has brief deployment and host-failure downtime; durable checkpoints recover inbound work. [Fly health checks](https://docs.fly.io/reference/health-checks)

On October 5, 2026, the official Homebrew CLI automatically updated from `0.4.66` to `0.4.111` during `fly auth login`. Login and organization access are verified, `fly config validate --strict` passes, and `fly machine list` confirms zero Machines. App reservation does not establish billing readiness or an operational bridge. Recurring server spend remains to be confirmed before deployment. [Official CLI installation](https://docs.fly.io/flyctl/install), [Fly billing](https://docs.fly.io/about/billing)

Budget estimate: the October 1, 2026 pricing page's reference shared-CPU 256 MB rate is $2.19/month, plus $1.50/month for the additional 256 MB at $6/GB/month: **approximately $3.69/month compute** for continuous operation. Tokyo uses Asia Pacific egress at **$0.04/GB**, giving a reference estimate of **$4.09/month at 10 GB outbound traffic**. Compute varies by region and billed runtime; verify the selected `nrt` quote before provisioning. This estimate is not a spending cap and excludes taxes and existing Photon/Supabase/Vercel charges. Avoid spare Machines, remote build Machines, volumes, and paid dedicated IPs. [Current Fly pricing](https://fly.io/pricing-update/)

For a fresh account, run the following from `apps/photon-bridge` after confirming the intended organization. Skip app creation when `fmat-photon-bridge` already exists in that organization. App creation reserves the name but does not deploy the container. Confirm billing and the recurring server budget before deploying. If the name is unavailable, choose a new name and update `fly.toml` plus every `--app` argument before continuing.

```sh
fly auth login
fly auth whoami
fly orgs list
fly config validate --strict --config fly.toml
fly apps create fmat-photon-bridge --org <verified-organization-slug>
```

Create a private file outside the checkout, permission mode `600`, containing only these runtime settings:

```dotenv
PHOTON_BRIDGE_ENABLED=true
PHOTON_BRIDGE_SECRET=<dedicated-secret-at-least-32-characters>
PHOTON_PROJECT_ID=<existing-project-id>
PHOTON_PROJECT_SECRET=<existing-project-secret>
```

The backend must receive the same dedicated `PHOTON_BRIDGE_SECRET` and its own `PHOTON_BRIDGE_ENABLED=true` through its runtime secret manager. The Fly file supplies the public production `FMAT_API_URL`; credentials are injected at runtime, never through Docker build arguments or image files. Enablement also uses a Fly secret so an omitted flag stays disabled and fails `/ready`. Import via stdin to keep secret values out of shell history; do not print the file or import the repository's root `.env`.

```sh
fly secrets import --stage --app fmat-photon-bridge < /private/path/photon-bridge.env
npm ci
npm run check
fly deploy --app fmat-photon-bridge --config fly.toml --ha=false --local-only --strategy immediate
fly scale count 1 --app fmat-photon-bridge --region nrt --max-per-region 1
fly machine list --app fmat-photon-bridge
fly checks list --app fmat-photon-bridge
fly status --app fmat-photon-bridge
```

Local Docker must be running for `--local-only`. Keep `--ha=false` on every deploy: Fly otherwise creates spare Machines by default. Verify exactly one started 512 MB Machine in `nrt` and a passing `/ready` check before describing iMessage setup as operational. The `min_machines_running` field is not a replica cap; the deploy flag and scale verification establish the singleton. Later restarts or redeployments must preserve the dedicated secret and the same backend checkpoint. These checks do not send a test message; any live send requires the user's specific authorization. [Fly deployment](https://docs.fly.io/launch/deploy)
