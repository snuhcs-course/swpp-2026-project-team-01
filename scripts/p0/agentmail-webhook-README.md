# Isolated AgentMail webhook probe

This loopback P0 receiver verifies actual provider callbacks for freshly created,
owned test inboxes. It is separate from the application and does not establish
P6 integration or authenticate a human sender. No production configuration or
existing inbox/webhook is changed.

Run `node scripts/p0/agentmail-webhook-server.mjs` from the repository root. It
binds only `127.0.0.1:8789`, with a public-safe `/health` and a signature-gated
`POST /webhooks`. Expose that isolated port temporarily with the installed
`cloudflared tunnel --url http://127.0.0.1:8789 --no-autoupdate`. Quick Tunnels
are disposable test infrastructure, not a production endpoint. Do not expose
the app, database, or private evidence directory through the tunnel.

Using the authenticated operator CLI, register a **new** webhook filtered to
only the freshly owned fixture inbox IDs. Never subscribe to the whole pod.
Use a persisted, task-specific `client_id` to recover an unknown create outcome.
Subscribe to `message.received`, `message.sent`, and `message.delivered` only.
Save its response (including signing secret) in ignored
`.local/p0-agentmail/webhook-resource.json` with mode `0600`.

Before triggering the controlled send, create private
`.local/p0-agentmail/webhook-config.json` with mode `0600`:

```json
{
  "namespace": "fmat-p0-agentmail-v1",
  "secret": "<this new webhook's signing secret>",
  "inboxIds": ["<verified fresh fixture inbox ID>"],
  "fixtureEmails": ["<verified fresh fixture address>"],
  "subjectMarker": "Find Me a Time P0 controlled AgentMail fixture"
}
```

The receiver verifies the exact raw bytes with HMAC SHA-256, constant-time
comparison, and a five-minute timestamp tolerance. The implementation follows
the [official Svix manual recipe](https://docs.svix.com/receiving/verifying-payloads/how-manual)
using Node's built-in crypto, with the independent published test vector in its
tests. Production should use the official verification library rather than
promoting this small diagnostic receiver unchanged.

Verified received events must match an allowed inbox and the fixture subject.
Sent/delivered events must match an allowed inbox and exactly one allowed fixture
recipient. Other events are refused. The receiver writes the raw body and selected
headers to a private `0600` ledger before HTTP 204. A serialized persistence queue
deduplicates both delivery ID and event ID, including across process restarts.
A repeated valid callback returns 204 without reprocessing; changed or stale
signed bodies return 401. The public endpoint does not expose the ledger.

Run `node scripts/p0/agentmail-webhook-replay.mjs` after an actual fixture callback
arrives, preferably within five minutes. It replays the captured provider bytes
unchanged and submits tampered bytes. Separately labelled, locally signed cases
exercise stale timestamps, the same event under a new delivery ID, and an inbox
outside the allowlist. These local cases are **not** additional provider events,
inbound delivery evidence, or evidence of actual 24-hour send-key expiration.
The sanitized result records the actual callback's event type.

```bash
node --test scripts/p0/agentmail-webhook.test.mjs
node --check scripts/p0/agentmail-webhook-server.mjs
node --check scripts/p0/agentmail-webhook-replay.mjs
```

After capture, re-fetch the created webhook and check its exact ID, task client
ID, inbox filter, and temporary URL before deleting **only that webhook**. Verify
the deletion, stop this receiver and its tunnel, and preserve the private fixture
state for safe reruns. Never delete unrelated resources or blindly recreate the
test inboxes. The single-inbox quota fallback cannot prove a conversation between
two distinct identities, and sent-parent replies do not prove received-parent
threading.

References: [AgentMail verification](https://docs.agentmail.to/webhook-verification),
[event shapes](https://docs.agentmail.to/events),
[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
