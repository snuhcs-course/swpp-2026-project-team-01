# Design

## Context

Remote `manage-invitations.mjs issue` validates an explicit linked project, creates a random secret, and persists only its hash in the invitation database. Supabase Auth email invitations already use custom SMTP; application admission invitations use a separate token and need explicit delivery.

## Goals / Non-Goals

Deliver admission invitations from the trusted operator CLI. Preserve verified-email redemption and local fixture behavior. Do not issue or resend any invitation merely by installing this change; do not modify existing invitation records or AgentMail resources.

## Decisions

- Send confirmed remote issue results by default; `--no-email` preserves manual credential handling, and local/revoke operations never send. Validate provider configuration before creating a remote invitation that requires mail.
- Reuse the existing Cloudflare sender adapter through Node's built-in TypeScript support (Node 24). Store a private mode-0600 receipt with frozen payload/sender and dispatch intent before sending, and retain it for recovery. No resend path or automatic provider retry is added.
- Email contains the exact invitation token, expiry, setup URL, and same-email sign-in instructions. Keep the token out of the URL. Provider acceptance does not consume or redeem the invitation.
- Onboard the apex domain and change environment/Auth sender settings. Keep prior subdomain DNS available for existing frozen delivery history; do not rewrite a dispatched identity.

## Risks / Trade-offs

- Email timeout may mean accepted mail → retain uncertain evidence and avoid automatic retry or reissue.
- Private invitation receipts contain authority-bearing tokens → keep them under ignored `.local/`, mode 0600, and never include credentials in diagnostic errors.
- Local tests cannot establish inbox delivery → verify transport behavior with injected providers, SMTP sender acceptance without DATA, DNS readiness, and Auth readback; explicitly report the remaining live-delivery gap.
