# Design

## Context

See [proposal](proposal.md). Browser authority is currently issued by `lib/server/identity/credentials.ts` and checked in service-only SQL operations. No MCP resource or OAuth consent page exists. Stock GoTrue v2.197.0 fails the resource tests recorded in the compatibility change; Google-only Supabase login remains the identity source.

## Goals / Non-Goals

**Goals:** One bounded authorization server for host and single-request client grants, suitable for the subsequent stateless HTTP MCP resource and thin CLI.

**Non-Goals:** Do not expose scheduling tools in this change, infer human decisions from token possession, or claim named-client compatibility. Do not copy provider tokens or guest continuation secrets into client tokens.

## Decisions

- Own the protocol boundary in Next.js and durable state in private Supabase tables. Reject a proxy to unmodified GoTrue because form/refresh resource enforcement and audience are missing. Use the existing verified host/guest credentials only in protected browser consent. No new login method.
- Use the configured application origin as issuer and its exact `/mcp` URL as the single resource. Require this resource at authorization, code exchange and refresh; never default or normalize a caller's different URI into it. Reject repeated parameters, malformed encodings, unknown scopes, unsupported grant types and plain PKCE. Token requests use form encoding. Initial clients are public with S256; fixed HTTPS or loopback HTTP callbacks must match registration exactly. No remote metadata fetch or logo loading.
- Permissions are `host:read`, `host:write`, `host:decide`, `request:read`, `request:write`, `request:decide`. One grant contains only one role's scopes. Consent binds a host or one current request; UUIDs alone cannot bind a requester. Decision permissions permit starting an attributable confirmation flow, not synthetic meeting approval. Missing scopes grant nothing.
- Use pinned JOSE for ES256 access-token signing/verification. Require `typ: at+jwt`, configured issuer, exact singleton resource audience, bounded iat/exp, unique jti, client and grant IDs, actor kind/ID and canonical scopes. Tokens last at most five minutes and never outlive their grant. Claims contain no email, request secret, Auth session token or provider credential. Cryptographic verification is necessary but not sufficient: every operation and refresh checks the current grant and original authority.
- Configure an active private JWK plus up to three retiring public verification keys, with unique IDs; publish only public fields. Never fetch a token-supplied key URL or accept embedded key material. Rotation preserves old public keys only until all old access tokens expire; removing a key revokes cryptographic acceptance immediately. Missing/bad configuration fails closed and must not fall back to Supabase keys.
- Persist hashed authorization codes and refresh credentials, client/resource/redirect/challenge/scope snapshots, actor binding and expiry. Authorization lasts ten minutes, codes one minute, grants at most thirty days and no later than requester authority. Refresh rotates atomically; a consumed refresh token cannot mint another family. Reuse revokes the family; lost refresh responses require reauthorization rather than accepting indefinite replay. Code redemption is single-use under concurrent exchange.
- Consent uses same-origin protected POSTs, an initiating-browser binding, explicit labeled grant/deny controls, escaped untrusted client names and exact scope descriptions. Refresh never expands scopes or changes resource/actor/client. Revoking a grant, host admission/session loss, guest rotation/closure/expiry or client disablement denies further access. Browser readback supports safe recovery of consent outcomes without placing tokens in model context.
- Before public registration/authorization is enabled, enforce fixed-size database budgets: 30 registrations per hour globally, 600 authorization attempts per minute globally and 20 per client per minute; no stored raw IPs. Bound registration and token bodies to 16 KiB/five seconds and token strings to 8 KiB. Document and revisit measured limits in operations hardening.

## Risks / Trade-offs

- Custom protocol code → keep a small surface, use established JOSE crypto, strict parsers and real concurrency tests; test negative resource/audience/PKCE paths independently of UI.
- Public registration abuse → bounded budgets, few exact redirects, no remote metadata fetch and no authority from registration alone.
- Lost token responses → single-use codes/rotating refresh favor explicit reauthorization; never mint multiple grants on retries.
- Stale signed JWT → current server-side grant and underlying authority checks remain mandatory.
- Future client requirements → add supported modes only with a tested named-client case; no silent relaxation for unsupported clients.

## Migration Plan

Land tested internal primitives first without public discovery or endpoints. Generate additive desired-schema migrations, rebuild the disposable local chain and verify isolation/concurrency. Add consent and protocol routes only once grants are enforced. Provision release-only signing material without logging it; review migration dry run, deploy from committed source and verify protocol/resource guards. Rollback disables authorization/resource entry while retaining revoked/uncertain state; never remove history or revive a consumed credential. Archive only after real browser/terminal flow and negative cases pass; named-client and MCP tool gates remain separately tracked.
