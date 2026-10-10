# Managed runtime recovery fixture

These modules belong only in an isolated diagnostic **preview deployment**. They
are never imported by the product agent and must never be promoted to a release
alias. Use the pinned Eve version, production conversation channel and shared
application modules, with the deterministic `fixture-agent.ts` replacing the
model and `fixture-update-tool.ts` as the sole mutation tool.

The operator creates one synthetic Auth user named
`managed-runtime-<user UUID>@example.test`, one matching admitted host and one
synthetic request. Configure `FMAT_MANAGED_PROBE_HOST_ID` and
`FMAT_MANAGED_PROBE_REQUEST_ID` for those exact records. The tool checks preview
environment, current guest grant and exact request before performing the actual
requester draft operation. It then writes a one-shot marker to that synthetic
user's app metadata and kills its own diagnostic worker before returning the
committed result to Eve. A managed replay must retain the canonical session and
idempotency identity, return the same draft and settle one accepted input.

Send `managed-recovery-probe` through the normal authorized conversation route.
Inspect the synthetic database records for one draft, unchanged shared request
revision, one accepted/completed input, retained session and bounded model work.
Repeat the same client ID/text, reconnect the stream, send a continuation and
revoke the request. Verify replay adds no draft and revoked read/send/stream
access fails. Retain only sanitized counts, timings and provider statuses.

The fixture uses no real model, Calendar, email or iMessage provider. A hosted
fixture tests managed Workflow behavior; it does not establish real-provider
compatibility or prove the public release's complete recovery SLA. Clean up only
the exact synthetic database records after revoking access and stopping work;
remove the diagnostic deployment. Managed checkpoint/log retention is separate
from database cleanup. Never reset or globally clean the release database.

## Recorded managed acceptance

The [2026-10-10 acceptance](../../documentations/technical_specification/05_rebuild_evidence.md#managed-workflow-recovery-acceptance--2026-10-10)
records the exact source, diagnostic overlays, preview deployment, observed
SIGKILL and managed redelivery, one draft and canonical session, stream/cursor
continuation, replay accounting, revoked access and verified cleanup. The
diagnostic preview was removed after its Workflow run was cancelled. The public
release alias was never promoted to this fixture.

The diagnostic used exact synthetic records in the selected release database.
That does not prove environment isolation: the preview temporarily had a
privileged server credential. No real model or messaging credentials were
needed. To keep the release Cron from dispatching these synthetic inputs to its
real model, the operator atomically accepted each exact input and moved only its
`next_dispatch_at` twenty minutes ahead, then delivered the same client ID/text
through the normal diagnostic HTTP route. Therefore this run tests managed
step redelivery, not production Cron wake-up. The local runtime suite separately
tests missed inbox delivery and the authenticated recovery dispatcher.


## Terminal-generation recovery fixture

`terminal-agent.ts` is a separate preview-only deterministic model guarded by the exact synthetic host/request IDs above. Mount only the production `propose_request_details` and `read_history` tools with the production conversation channel. Send `managed-terminal-archive` to create a prior unconfirmed draft and record nonzero usage, then `managed-terminal-authentication` to reproduce the legacy terminal failure after normal reservation/failure accounting. `managed-terminal-recover` requires retained successor context and the real archive tool before proposing one further unconfirmed draft. Other text produces a bounded continuation. No real model or messaging provider is used. The local actual-eve test validates this fixture before managed deployment; it does not establish managed acceptance.

For each synthetic input, atomically accept it through the real private command and move only its dispatch timestamp into the future before committing. Deliver/retry that exact client ID through the protected diagnostic route. Inspect and reconcile the terminal state through the production recovery endpoint, then verify one generation transition, original pending identity, old and successor history, retained usage/attempts and unchanged human decisions. Revoke the exact request, stop only its managed runs after verifying deployment identity, and delete only those synthetic records and the diagnostic preview. Never promote this overlay to a release alias.
