# Paired AgentMail webhook probe

This receiver is dedicated to the two product-controlled identities frozen in
`.local/p0-agentmail/distinct-payload.json`. It reuses the existing raw Svix
verifier and durable deduplication library, but stores configuration and raw
events in the separate mode-`0700` directory
`.local/p0-agentmail/distinct-paired-webhook/`. Private JSON files are `0600`.

The receiver binds only `127.0.0.1:8790`. A disposable Cloudflare Quick Tunnel
may expose that port during the controlled run. The task webhook subscribes to
`message.received`, `message.sent`, and `message.delivered` for exactly the two
inbox IDs; it has no pod filter. Its persisted client ID permits recovery after
an unknown create response. At most six actual callbacks are accepted.

```bash
node scripts/p0/agentmail-paired-webhook-server.mjs
cloudflared tunnel --url http://127.0.0.1:8790 --no-autoupdate
node scripts/p0/agentmail-paired-webhook-admin.mjs setup
node scripts/p0/agentmail-distinct-probe.mjs run
```

After all six provider callbacks arrive, restart the loopback receiver while
preserving its ledger, record that restart in private state, and run:

```bash
node scripts/p0/agentmail-paired-webhook-replay.mjs
```

The replay check verifies exact provider bytes after restart, deduplication,
tamper rejection, stale timestamp rejection, and outside-allowlist rejection.
Its callback binding treats thread IDs as inbox-local: the original inbox's
initial send and reply receive must agree, and the fixture inbox's initial
receive and reply send must agree. It never requires the two inboxes to expose
the same thread ID.

Finally delete only the persisted task webhook, verify its exact client ID,
URL, event set and two-inbox filter before deletion, confirm GET returns 404,
then stop the tunnel and receiver.

```bash
node scripts/p0/agentmail-paired-webhook-admin.mjs cleanup
node scripts/p0/agentmail-paired-webhook-finalize.mjs
node --test scripts/p0/agentmail-paired-webhook.test.mjs
```
