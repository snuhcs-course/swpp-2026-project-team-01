# Controlled AgentMail P0 probe

This probe is phaseable so fixture ownership can be reviewed before any email is sent. It uses exactly two newly created inboxes in the existing **Find Me a Time Development** pod. It never targets a human-provided address, never deletes an existing resource, and never requests an upgrade or paid resource.

When two free inbox slots are unavailable, the separately invoked `single-self` fallback can create one fresh owned inbox and send only to itself. That mode can exercise transport, idempotency, webhook delivery, and provider threading, but it cannot prove separation between sender and recipient identities. Its result therefore keeps OpenSpec task 2.4 open.

The CLI must be AgentMail 1.8.0 and authenticated with the operator credential in macOS Keychain. The script deliberately runs the CLI outside the repository with `AGENTMAIL_API_KEY` removed so the pod-scoped application key in `.env` cannot shadow the administrative keyring credential. The root `.env` must have mode `0600` and supply the existing pod ID and application key; neither value is printed.

## Phase 1: provision and verify ownership

```bash
node scripts/p0/agentmail-probe.mjs prepare
```

Before creating anything, preparation lists all inboxes visible to the operator. It creates the two fixtures only when the total is at most one, which keeps the resulting total within the official Free plan quota of three. A higher count fails with `FREE_PLAN_FIXTURE_CAPACITY_BLOCKED`; the script does not delete existing inboxes or attempt a plan change.

Private inbox IDs, addresses, ownership material, idempotency keys, and payloads live only under ignored `.local/p0-agentmail/`. The directory is mode `0700` and every JSON file is mode `0600`. The committed result contains only counts, booleans, a one-way ownership fingerprint, and safe status codes.

For every new fixture, preparation persists a deterministic provider `client_id` before the create request. If a create response is lost, preparation retries the exact request and searches the pod by that client ID before it can issue any different create. A partially written state file resumes missing fixtures under the same Free-plan capacity guard. The first single-self fixture created during development predates this hardening and has no provider client ID; its successful create response and exact provider ID were persisted, so no unknown outcome occurred for that fixture.

Successful preparation prints an ownership fingerprint. Review that the result says `fixtureCount: 2`, `ownershipGuardPassed: true`, and `sendExecuted: false` before running phase 2.

If the pair mode is blocked because the account already has two inboxes, prepare the approved single-identity fallback instead:

```bash
node scripts/p0/agentmail-probe.mjs prepare-single
```

This path requires a global count of at most two and creates exactly one inbox with task-specific ownership metadata. It reports the safe webhook namespace `fmat-p0-agentmail-v1` and subject marker `Find Me a Time P0 controlled AgentMail fixture`. The exact inbox ID remains only in `.local/p0-agentmail/fixtures-single-self.json` for the isolated receiver allowlist.

## Phase 2: controlled provider send

```bash
node scripts/p0/agentmail-probe.mjs send <reviewed-ownership-fingerprint>
```

For the single-identity fallback, use `send-single` with the fingerprint emitted by `prepare-single`.

The send phase re-fetches both inboxes and requires exact matches for their private IDs, pod ID, addresses, fixture roles, and ownership fingerprint. It also requires the recipient to be the locally recorded peer fixture. It then performs these bounded checks:

1. Persist the attempt before dispatch, send with the fixed idempotency key, and keep accepted message/thread IDs privately for comparison. If a response is lost before it can be saved, rerunning within the immutable retry window uses the same key and payload to recover the unknown outcome.
2. Retry the identical payload and require the provider to return the original message and thread IDs.
3. Reuse the key with changed text and require HTTP 409.
4. Poll the recipient at most three times, reply using the received parent message ID, and poll the original sender at most three times.
5. Require the reply and received reply to stay in the original thread.

Only the initial message and reply can cause delivery, for a maximum of two actual fixture emails. Each CLI request has a 55-second timeout; polling uses at most three calls with short local delays.

The 24-hour idempotency horizon is checked from the CLI 1.8.0 schema and represented by a local expiry timestamp in the private result. The committed result explicitly records that actual provider expiry after 24 hours was not observed. Webhook signature and replay checks are handled by the separate webhook receiver probe.

## Captured single-identity outcome

The 2026-10-05 controlled run started with two existing operator-visible inboxes, so pair preparation stopped before mutation. The approved fallback created one task-marked inbox in the development pod, reaching the Free-plan total of three. The original development inbox and the unrelated Default Pod inbox were not used or changed.

The initial fixed-key send was accepted once. Its response was intentionally not retained by the first caller; the retry returned a provider record whose ID and thread matched the only exact initial provider record. Reusing that key with changed text returned 409. AgentMail represented the self-send only as `sent`, so the bounded received-message poll found no received parent.

The controlled continuation replied once to the exact persisted `sent` parent with an explicit sole recipient equal to the same owned fixture. Retrying that reply with its persisted idempotency key returned the same message and thread IDs, and the provider reply remained in the original thread. The run consumed exactly two actual fixture emails. This is useful transport, idempotency, sent-event, and threading evidence, but it is not received-parent or distinct-identity evidence; task 2.4 remains open.

The isolated webhook receiver captured exactly two actual callbacks for the reply, `message.delivered` and `message.sent`, and matched both to the private reply message and original thread. Raw signature verification passed. Exact provider-event replay stayed deduplicated after receiver restart; a tampered body and locally signed stale timestamp were rejected, while the same event under a new locally signed delivery ID was deduplicated and an outside-inbox event was denied. See [the sanitized webhook result](./agentmail-webhook-results-2026-10-05.json). The pod-scoped application key also fetched the fresh fixture and matched its private inbox and pod IDs in an independent check.

## Verification

```bash
node --test scripts/p0/agentmail-probe.test.mjs
node --check scripts/p0/agentmail-probe-lib.mjs
node --check scripts/p0/agentmail-probe.mjs
```
