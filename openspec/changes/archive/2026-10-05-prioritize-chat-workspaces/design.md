# Design

## Context

See [proposal.md](proposal.md). Host setup and request workspaces already render durable conversations alongside structured controls. Existing AI Elements components supply conversation, message, prompt, and suggestion primitives; shadcn preset `b6rtA2Hmi` supplies the UI base. Command authorization and version checks live in the backend and must remain the source of truth.

## Goals / Non-Goals

**Goals:** Make conversation the default viewport, keep the next decision in context, and retain structured controls as a reliable secondary route.

**Non-Goals:** A new assistant backend, implicit approval from free text, a new chat protocol, changing Calendar or OAuth scopes, or replacing exact server review objects with model prose.

## Decisions

### Recompose existing views

Use the existing conversation components and server-derived state. Place artifacts and their buttons in the message flow or immediately following the relevant turn; use existing shadcn Card/Badge/Button and AI Elements patterns. Keep the structured forms intact in a secondary tab or settings surface. This reduces duplicate command logic and preserves recovery. A new standalone chat state machine would risk conflicting revisions and audience leakage.

### Keep decisions explicit

Buttons dispatch the same mutation functions currently used by manual controls, including expected revision, review identifier, and the audience-specific credential. A chat response is explanatory; it does not become approval, agreement, or Google consent. Refresh the authoritative projection after success or stale conflict before presenting further actions.

### Responsive, accessible layout

The conversation occupies the primary column and viewport on desktop and mobile. The secondary controls retain labeled navigation and focus behavior. Artifacts use concise visible details and do not include private host data in requester views. Pending and failed actions remain in context without removing the composer.

An account-free requester still needs private continuation authority. A protected link restores that authority automatically without asking for a pasted credential. A browser without authority sees no request details and a short instruction to use the private link. The existing backend recovery API remains unchanged, but neither credential entry nor recovery initiation appears in the request interface.

## Risks / Trade-offs

- [Moving controls obscures recovery] → Keep a visible labeled route to structured controls and test model failure and consent interruption.
- [Duplicate buttons act on stale data] → Reuse current server revisions and refresh after conflicts.
- [Conversation becomes crowded on mobile] → Keep artifacts compact and verify phone-width layout and keyboard traversal.

## Migration Plan

Ship as a website-only change, preserving URLs, saved conversations, and backend operations. Run targeted browser checks, typecheck, lint, build, and responsive inspection. Rollback restores the prior layout without data migration.
