# Proposal

## Why

Hosts should be able to set up Find Me a Time by talking in the website or iMessage, without translating their preferences into a long configuration form. The current setup page and verified Photon transport provide the foundations, but there is no shared setup conversation or product identity link for iMessage.

## What Changes

- Make conversational setup the default `/host/setup` experience using the user-selected [AI Elements](https://elements.ai-sdk.dev/llms.txt) Conversation, Message, Prompt Input, and Suggestion components; preserve shadcn preset `b6rtA2Hmi` and provide structured controls within the chat when needed.
- Persist one host-owned setup conversation and versioned settings draft, resumable across website and linked private iMessage.
- Let hosts describe their name, handle, timezone, meeting windows, durations, buffers, and other supported rules in natural language; clarify ambiguity and require confirmation of a concrete settings summary before applying it.
- Guide invitation redemption and Google consent through verified browser handoffs, then resume chat automatically from server state. Neither a phone number nor a model response grants host access.
- Add explicit website-to-iMessage account linking, unlinking, and a narrow Node Photon bridge that routes verified private messages into the same onboarding operations.
- Keep readiness and public-link publication dependent on existing admission, confirmed rules, calendar permissions, and handle checks. Setup conversation cannot approve a meeting or create an event.

## Capabilities

### New Capabilities

- `conversational-host-setup`: durable, channel-independent setup dialogue, preference review, provider handoffs, and verified host iMessage linking.

### Modified Capabilities

None. Reuse the current [application command contract](../../specs/application-commands/spec.md) and the in-flight [host admission](../implement-host-admission/specs/host-admission/spec.md) and [calendar connection](../connect-google-calendars/specs/calendar-connections/spec.md) requirements without weakening them.

## Impact

- Website: `apps/web/src/Host.tsx`, new AI Elements components, setup chat controller, and browser tests.
- Shared backend: `supabase/functions/api/routes/onboarding.ts`, onboarding orchestration/model extraction, contracts, private persistence and command handlers in `supabase/schemas/`, and generated migrations.
- Messaging: new narrow Node bridge using the already tested Spectrum 12.10.1 transport; durable inbound deduplication, outbound delivery records, and authenticated internal commands.
- Dependencies: only AI Elements components and their necessary pinned dependencies requested by this change; inspect Base UI compatibility before installing. Preserve the existing application runtime and model provider.
- Owning documentation: [host setup](../../../documentations/technical_specification/06_host_setup.md), [interfaces](../../../documentations/user_experience/03_interfaces.md), [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md), and product onboarding requirements. This advances a bounded onboarding slice of P6; full iMessage scheduling remains separate.
- Deployment target: Fly.io, with one `fmat-photon-bridge` Machine running in Tokyo and secret injection, readiness and restart recovery recorded in the [live evidence](../../../scripts/p0/fly-bridge-live-results-2026-10-05.json). Real linked-host verification remains a rollout gate. Website chat remains available during bridge outages.
