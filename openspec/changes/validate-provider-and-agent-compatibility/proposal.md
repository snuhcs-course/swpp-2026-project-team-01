# Proposal

## Why

The provider provisioning record proves that credentials exist, while scheduling still depends on unverified authorization, transports, and client behavior. P0 must make runtime choices and record reproducible compatibility evidence before affected adapters are treated as ready.

## What Changes

- Record runtime, framework, package, model, credential-recovery, expiry, language, and online-link decisions for P1–P4.
- Add safe reproducible provider probes and an evidence matrix for Google, Supabase, Routes, OpenAI, AgentMail, Photon, and the seven named personal-agent clients.
- Document controlled test identities, required callback URLs, transport limitations, and confirmation mechanisms.
- Preserve untested or unsupported cases as explicit gaps; independent foundation work proceeds while adapter-specific checks remain incomplete.

## Capabilities

### New Capabilities

None. This change supplies decision records and compatibility checks; application behavior belongs to P1–P4 changes. `skip_specs: true` is intentional.

### Modified Capabilities

None.

## Impact

Provider scripts, setup evidence, backend-contract documentation, and [implementation plan P0](../../../documentations/technical_specification/04_implementation_plan.md). Basis: [PRD client and approval requirements](../../../documentations/02_product_requirements.md), [technical specification](../../../documentations/03_technical_specification.md), and [provider setup](../../../documentations/technical_specification/03_provider_setup.md).

Actual Dots, Muse, Instinct, ChatGPT, Codex, Claude, and Claude Code OAuth tests and controlled Photon/AgentMail conversations remain unresolved until evidence is captured. This proposal does not claim P5/P6 implementation or release-wide compatibility.
