# Design

## Context

See [proposal.md](proposal.md). Next.js has public intake and private browser workflows but no skill routes. `PublicIntake.profile` already checks admission, readiness, current grant and calendar permissions; reuse it rather than bypassing readiness through a second profile lookup.

## Goals / Non-Goals

**Goals:** read-only documents, fixed origin links, bounded public fields, neutral errors and truthful continuation.

**Non-Goals:** OAuth/MCP/CLI implementation, handle lifecycle changes, root-domain promotion or named-client acceptance. These remain full-plan obligations.

## Decisions

- Shared server renderer with injected public-profile reader supports unit tests. Route handlers never read cookies and expose only GET/HEAD. Disable framework and HTTP caching so readiness does not persist after revocation.
- Use `applicationOrigin` for links; ignore request Host, forwarded headers, query parameters and arbitrary redirects.
- Put allowlisted host data in a JSON code block, escaping backticks, angle brackets and format/line-control characters. Never interpolate display text into service prose or URLs.
- Reuse the same ready-profile path as public intake, including provider failures. A neutral 404 means unavailable; other failures return 503 and a bounded retry hint without raw errors. Reading instructions does not promise that a later intake succeeds; the actual command rechecks authority and readiness.
- Publish a date-based instruction version independently of API schema. State that protected agent tooling is not yet available in this release and supply existing browser routes. Do not publish guessed OAuth endpoints or CLI commands.

## Risks / Trade-offs

- Public profile resolution invokes Google metadata reads → retain the existing bounded provider adapter and no-store semantics; do not claim provider failure means the host is free.
- Agents can misinterpret host data → clearly label encoded data and service-only instructions, while every operation retains server authorization.
- Versioned instructions cannot certify all clients → keep AC-23–25 and per-client tests open.

## Migration Plan

No database migration. Deploy routes with both builds, test public root and unavailable-host responses on release, and retain production evidence. Rollback removes the routes without changing domain state.
