# F01 — Sign-in, sessions and demo/real modes

## Intent
- Identify the owner of personal calendar data unambiguously in real use, while keeping a zero-setup demo. `[doc PRD decision F]` `[code]`
- Keep **sign-in** and **calendar read permission** as two separate consents, so a user can sign in and still decline calendar access. `[code]` (`purpose: 'login' | 'calendar'`)
- Never let the demo account switcher become a way to reach real accounts. `[code]` (DB bound to one mode)

## How the user is led
- `/login` — headline "나에게 맞는 미팅 시간", subcopy "Calendar를 연결하면 AI가 일정을 살펴보고, 미팅 가능한 시간과 선호를 함께 정해요. 연결은 선택이에요." Right column: numbered 3-step card list (see `01-journey-map.md J0`). CTA: real "Google 계정으로 시작", demo "데모 시작".
- After sign-in `/` routes to `/settings/calendars` (no profile) or `/book`.
- Header (real): avatar initial + name + 로그아웃 (link-style button). Header (demo): "현재 사용자" select; switching posts `/api/session` then goes to `/book`.

## Rules (verified)
- OAuth start stores a hashed `state`, hashed `nonce`, a browser-binding hash (browser cookie + session token + purpose + user + connection generation) and a return path; TTL 10 min (`services/auth.ts startGoogleAuth`).
- Return paths are an allow-list (`/`, `/calendar`, `/book`, `/requests`, `/settings`, `/settings/calendars`, `/onboarding`, `/onboarding/review`) plus `/invite/<24-char token>` (`safeReturnPath`).
- Callback: attempt must be unconsumed and unexpired; nonce must match; consumption is a conditional UPDATE inside a transaction holding advisory lock `auth:<subject>` so first sign-in creates the user once.
- Login purpose creates `users` + `auth_identities(provider='google', subject)` on first sign-in, creates a DB session (token hashed with SHA-256, 7-day TTL) and revokes the previous session.
- Calendar purpose requires the signed-in actor to equal the attempt's user (`account_mismatch` otherwise) and **all** read-only scopes granted:
  `calendar.calendarlist.readonly`, `calendar.events.readonly`, `calendar.events.freebusy` (`providers/google-auth.ts CALENDAR_SCOPES`). Refresh token stored encrypted (`token-vault.ts`).
- Mutations require same-origin `Origin` header and reject `sec-fetch-site: cross-site` (`session.ts assertMutationOrigin`) — CSRF defence for every non-GET.
- Cookies: HttpOnly, SameSite=Lax, Secure on https; plain http only on loopback.
- Demo actor: cookie `uid`, falls back to the first user by id.

## Data / API
- Tables: `users`, `auth_identities`, `sessions`, `oauth_attempts`, `storage_settings` (mode binding).
- Routes: `POST /api/auth/google/start {purpose, returnPath} → {authorizationUrl}`, `GET /api/auth/google/callback`, `POST /api/auth/logout`, `POST /api/session {userId}` (demo), `GET /api/me`.
- Env: `APP_MODE`, `DATABASE_URL`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`, `IMPACT_SIGNING_KEY`.

## Code map
`server/session.ts`, `server/services/auth.ts`, `server/providers/google-auth.ts`, `server/token-vault.ts`, `server/config.ts`, `server/db/client.ts (bindDatabaseMode, ensureBound)`, `app/login/page.tsx`, `app/page.tsx`, `app/(app)/layout.tsx`, `components/{Header,NavMenu,UserSwitcher,LogoutButton,GoogleConnect}.tsx`, `app/api/auth/*`, `app/api/session`.

## Depends on / used by
Used by every feature. Calendar consent is the entry of F02.

## Transplant unit
- **Keep if the target has no auth**: the two-purpose OAuth (login vs. calendar), return-path allow-list, origin check, hashed tokens.
- **If the target already has auth** (e.g. Supabase Auth): keep only the *separate calendar consent* step and the rule "calendar connection belongs to the signed-in user"; map `actor.id` to the target's user id.
- Demo mode is optional; it is valuable for showing two-sided flows in one browser. Its pieces: user switcher, `mock-calendar` provider, seed + persona profiles + seeded contacts.
