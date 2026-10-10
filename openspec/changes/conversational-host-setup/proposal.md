# Proposal

## Why

Hosts should complete setup through guided conversation in `/app` or private iMessage, with useful suggestions, explicit preference choices and secure browser consent. Setup must be resumable without letting inferred preferences or transport identity become account authority.

## What Changes

- Lead every onboarding step with agent guidance and accessible in-chat actions, using AI Elements and the selected shadcn preset `b6rtA2Hmi`.
- Recommend calendar roles and offer a disclosed, host-selected bounded scan before suggesting editable meeting windows and location/mode preferences.
- Prefer explicit choices, then authorized evidence, then labeled starter defaults. Ask one unresolved question at a time and require a current settings review before saving.
- Explicitly ask mode/location, then transportation and extra travel buffer for hosts accepting physical meetings; support per-meeting/per-trip policies and reuse explicit prior answers.
- Author structured clarification questions in the application using bounded English/Korean categories; never display arbitrary model prose as setup guidance.
- Persist a host-owned setup conversation and versioned draft across web and linked private iMessage.
- Restore explicit private-channel settings confirmation through an application-authored, expiring review reference; ordinary chat/model tools retain draft-only authority.
- Provide protected sign-in, invitation and Google handoffs plus inline iMessage phone/code linking, unlinking and recovery.
- Keep admission, Calendar permissions, handle/readiness checks and booking approval separate from conversational inference.

## Capabilities

### New Capabilities

- `conversational-host-setup`: durable setup dialogue, guided preference review, browser handoffs and verified private iMessage linking.

### Modified Capabilities

None. Reuse the [application command contract](../../specs/application-commands/spec.md), current [admission requirements](../../../documentations/02_product_requirements.md), and pending [Calendar connection requirements](../connect-google-calendars/specs/calendar-connections/spec.md).

## Impact

`agent/` owns eve guidance/tools/channels; `apps/web/` owns Next.js chat and action cards; root `lib/contracts/` and `lib/server/` own typed actions, authorization, onboarding and provider operations. Supabase owns private domain persistence and migrations. Evaluate the native eve Photon channel before creating any separate transport service.

Follow the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md), [frontend architecture](../../../documentations/technical_specification/02_frontend_architecture.md) and [backend architecture](../../../documentations/technical_specification/01_backend_architecture.md). Replacement implementation and controlled live verification remain pending; no additional provider or Google scope is authorized by this cleanup.
