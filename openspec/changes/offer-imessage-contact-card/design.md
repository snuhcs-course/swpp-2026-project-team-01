# Design

## Context

See [proposal](proposal.md) for motivation. Existing `photon_links` stores host, project, recipient, line and private chat after code proof. The protected `IMessageLink` card reads a masked view. `HostIMessage` verifies application credentials and delegates current admission/session checks to SQL. Existing delivery workers enforce environment admission, lease fencing and reauthorization after provider preflight.

The installed `@photon-ai/advanced-imessage` 2.2.0 exposes `chats.shareContactInfo(chat): Promise<void>`. It supplies neither a client message identity nor a reconciliation handle. The existing text-message outbox's GUID-based reconciliation therefore cannot prove native contact delivery. [Photon native sharing](https://photon.codes/docs/spectrum-ts/providers/imessage/messaging-features/contact-card-sharing) sends the local account's card; [shared routing](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing) does not promise one global sender number.

## Goals / Non-Goals

**Goals:** Recover a committed host request after a lost wakeup; avoid duplicate external dispatch after ambiguous failure; expose sanitized status after reload; preserve current link and session authority.

**Non-Goals:** Modify the provider account profile, import a contact automatically, synthesize a vCard from a guessed shared-pool number, or grant any meeting/notification authority. No model or MCP tool can request this effect.

## Decisions

1. **Explicit protected browser action.** Add a strict same-origin action accepting link ID and retry UUID. Derive host, recipient and route on the server. Successful linking alone never requests contact sharing. Return only a sanitized status in the current link view. The browser explains that the host completes saving inside iMessage. Automatic post-link sends were rejected because linking does not express this optional choice.

2. **Dedicated durable intent.** Add an RLS-enabled private table with one intent per link, initiating credential, request key, frozen project/line/chat/recipient, timestamps, status, attempt count and lease ownership. Creation, audit and recoverable work are atomic. A unique link constraint deduplicates concurrent clicks even with different retry UUIDs; conflicting reuse against another link is rejected. Reuse the existing bounded internal scheduler/worker conventions, with a separate service-only RPC and dispatch endpoint. Do not repurpose link-code fields or text-message provider references.

3. **Conservative dispatch boundary.** States are `queued`, `dispatching`, `accepted`, `failed`, `revoked`, `uncertain`. Claiming assigns a bounded lease but leaves the intent queued until preflight completes. Immediately before the native call, SQL rechecks lease, enabled receiver, active link, unchanged frozen route and current initiating session/admission, then atomically records `dispatching`. A recovered dispatching intent becomes uncertain and is never dispatched again. An acknowledged RPC can record accepted only with the current lease. Expired/stale finish cannot manufacture acceptance. A crash between dispatch marking and the actual network call sacrifices delivery certainty to prevent duplicate sharing.

4. **Bounded pre-dispatch recovery.** Token acquisition and reachability failures before the dispatch marker may retry within three claims, then persist a sanitized failure. Known unreachable recipient is a definitive pre-send failure. Authority revocation records revoked. After the dispatch marker, any throw or response loss remains uncertain, including errors whose exact delivery semantics are not documented. Native share uses existing TLS, ten-second timeout, disabled retries and disabled automatic idempotency. No repeat button creates another share for an accepted or uncertain link; status refresh is safe.

5. **Independent environment and authority guards.** Worker rejects non-production Vercel environments before claiming state; transport independently rejects before network access. Recheck authority after preflight immediately before the native operation. New requests and undispatched work are denied after unlink, replacement, host/session revocation or receiver disablement. A side effect already dispatched cannot be recalled; the UI must not suggest unlink retracts a card.

6. **Truthful outcomes.** Accepted means only that the native RPC acknowledged. The UI never claims delivered, saved or named Find Me a Time on the device. Uncertain explains that the host should check the existing conversation and does not offer a blind resend. Do not expose full phone, route tokens, provider errors or original credential in browser/diagnostic responses. Add a separate `diagnostics --contacts` snapshot for aged queued, failed and uncertain/in-flight work with bounded identifiers; keep the existing operational v1 snapshot contract unchanged.

## Risks / Trade-offs

- Shared pool profile or route behavior differs on a real device → verify the saved route and native card with an explicitly authorized recipient before release acceptance; keep receiver activation gated.
- Native sharing has no idempotency/reconciliation proof → one dispatch per link and durable uncertainty, including the crash-before-call window.
- Session expires while work waits → revoke unsent work rather than using an expired host action; show truthful state and require a fresh verified link for a new intent under this bounded policy.
- Profile display depends on the recipient's device → record OS/provider evidence separately; automated RPC tests prove no import or display-name outcome.

## Migration Plan

Add desired schema and generate/review an additive migration with CLI 2.119.0; rebuild the disposable local chain and verify RLS, concurrency, lease expiry, authority and atomic publication. Deploy database before application with dry-run review against the selected project. Keep the production receiver disabled until existing live-channel acceptance and the contact-card device gate pass. Rolling back the UI/worker leaves durable rows intact and must not reset dispatch markers or resend unknown outcomes.

## Open Questions

Which exact iPhone OS and provider profile are used in controlled acceptance will be recorded when the authorized test recipient is available. This affects evidence, not the behavior contract or automatic retry policy.
