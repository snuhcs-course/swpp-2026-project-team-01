# Proposal

## Why

Phase 7 of the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md) requires an optional contact card after the verified private iMessage exchange. The current linking UI establishes identity but offers no way to request that card.

## What Changes

- Add an explicit Add to contacts action for an authenticated, admitted host with a current verified private link. Explain that it requests a card in iMessage and the recipient chooses whether to save it.
- Persist the host's request and its frozen route before dispatch, with one logical request per link, current authorization checks and recovery that never blindly repeats an uncertain native share.
- Use Photon native account contact sharing on the link's saved project, line and chat route; never invent a global sender number for a shared pool.
- Report queued, provider-accepted, failed, revoked and uncertain outcomes truthfully. Provider acceptance does not prove device delivery, contact import or displayed product name.
- Verify server, database, provider and browser behavior; retain a separate authorized real-device/profile acceptance gate.

## Capabilities

### New Capabilities

- `imessage-contact-sharing`: Optional sharing of the service account's native contact card with a verified linked host, including durable intent, authorization and observable outcomes.

### Modified Capabilities

None. The [conversation authority](../../specs/conversation-access/spec.md), [durable jobs](../../specs/durable-jobs/spec.md) and [messaging environment](../../specs/messaging-environments/spec.md) contracts remain unchanged. This complements the pending [verified linking requirements](../conversational-host-setup/specs/conversational-host-setup/spec.md), without promoting that broader change before live acceptance.

## Impact

Affected areas: `lib/contracts/imessage.ts`, Photon service/transport, the protected browser routes and iMessage card, declarative schema plus an additive migration, scheduled recovery, diagnostics and relevant tests. Reuse the installed Photon SDK; no new transport dependency is required.

The [PRD](../../../documentations/02_product_requirements.md) and [provider setup](../../../documentations/technical_specification/03_provider_setup.md#display-name-contact-cards-and-profile-sync) own the product purpose and live profile setup. Whether each configured shared/dedicated route shares the expected account profile and renders the intended name on iPhone remains unverified. No automatic contact import, profile rename, consent grant or arbitrary recipient send is included.
