# Design

> 후속 변경: `selected-slots-and-meeting-approval`에서 호스트의 공개 범위·길이·후보 선택과 Google 일정 수락/초대를 추가했다. 이 문서의 수락 제외·읽기 전용·자동 구간 생성 설명은 당시 기준이며 현재 동작은 후속 변경을 따른다.

## Context

제품 목적과 MVP 범위는 `proposal.md`를 따른다. Next.js 코드는 `apps/web`에 있다. 2026-10-05 기준 로컬 환경 변수가 설정되었으며, 선언형 스키마에서 생성한 `20261004153236_add_caltalk_core.sql`을 로컬 재생성으로 검증하고 앱에 설정된 Supabase 프로젝트에 적용했다. 사용자 로그인으로 저장된 소유자·요청자의 연결을 사용해 실제 Calendar 조회, 후보 3개 계산, 미팅 요청 저장 및 소유자 API 조회까지 확인했다. 이 검증에 사용한 임시 요청은 삭제했다. 사용자는 이후 실제 요청이 정상적으로 동작함을 확인했다. 소유자 캘린더와 링크 관리는 후속 변경 `owner-calendar-and-share-links`에 기록한다.

## Goals / Non-Goals

**Goals:**
- Verify Google account and read-only Calendar connection from the locally running web application first.
- Keep the owner and requester flows in one web application.
- Read each person's primary Google Calendar only after that person grants permission.
- Calculate a small number of explainable candidate times on the server and persist requests in Supabase.
- Keep Google credentials and service-role access on the server.

**Non-Goals:**
- LLM-based preference chat or natural-language interpretation.
- Creating or confirming Google Calendar events.
- Google Maps routing or travel-time estimates.
- Automatic email notifications, account disconnection, or account/data deletion UI.
- Publicly deploying the web application; local execution is sufficient for this MVP.

## Decisions

### Web application and server boundary

Next.js provides the public pages and server routes in `apps/web`. Browser pages call same-origin API routes. The browser never receives the Supabase service-role key or Google refresh tokens. The server performs OAuth exchanges, Calendar API requests, scheduling, and Supabase writes.

### Google authorization and session

Each participant grants Google authorization separately. The app requests `openid`, `email`, and `calendar.events.readonly`; scheduling reads start, end, location and busy/free state. The owner-only calendar visualization additionally reads titles, IDs and all-day state without storing titles or exposing them to requesters. Attendees are not read. OAuth state uses a signed, short-lived, one-time nonce cookie; the requester share code stays in that server cookie rather than in the state value. Refresh tokens are encrypted with AES-256-GCM before storage. The app uses a signed, HTTP-only session cookie for its own owner/requester role; Supabase Auth is not used.

### Supabase data model and access

The declarative schema is `supabase/schemas/caltalk.sql`.

- `owner_calendars` identifies the owner by Google's stable `sub` value and stores email plus encrypted refresh token.
- `share_links` belongs to an owner and stores a hash of the share code. New links additionally store an encrypted code for owner re-copy, a name, fixed availability windows and period, and a soft-delete timestamp.
- `requester_calendars` associates a requester's Google account and encrypted token with one share link.
- `meeting_requests` stores requester details, meeting purpose, duration, location, candidate slots, and review status.

RLS is enabled on every table. Direct `anon` and `authenticated` access is revoked; server routes use the Supabase service role after checking the signed application session and ownership. The service-role key must remain server-only.

### Candidate scheduling

The agreed MVP rule searches the next 14 days in `Asia/Seoul`, Monday through Friday, from 09:00 to 20:00, testing start times in 30-minute increments. It excludes overlaps and applies a simple buffer: same or unknown location 15 minutes, different physical locations 45 minutes, and online-to-online 0 minutes (online-to-physical uses 15 minutes). It prefers same-place gaps and longer nearby gaps, with a mild preference for mid-day slots, then keeps up to three candidates spaced apart. Reasons are deterministic text based on those checks; no LLM or map service is used. Weekday filtering uses the Seoul calendar date. Candidate labels use explicit date/time fields, avoiding the invalid combination of dateStyle and weekday.

### Pages and server routes

- `/`: product landing page and owner connection entry point.
- `/owner`: owner request inbox and share-link creation.
- `/request/[code]`: requester calendar connection and request form.
- `/api/auth/google/start` and `/api/auth/google/callback`: OAuth start and return.
- `/api/share`: create an owner share link.
- `/api/requests`: owner request listing and requester submission.
- `/api/calendar/status`: current owner calendar connection status.

### Local verification and database setup

Secrets are supplied through ignored `apps/web/.env.local`, based on `apps/web/.env.example`. Run the web app locally and register `http://localhost:3000/api/auth/google/callback` as the Google OAuth redirect URI. Add the testing Google accounts to the OAuth consent screen's test-user list when the consent app is in testing mode. The first integration check is owner Google sign-in and read-only Calendar access; then verify requester access through a share link.

The app needs the Caltalk tables in the configured Supabase project to store the OAuth connection and complete its callback. Generate and review the declarative-schema migration before applying it to the intended project. No public web deployment is required for this MVP.

## Risks / Trade-offs

- **[Google consent scope may require verification for public use]** → Use a test-user list during development; complete Google verification before opening the app broadly.
- **[Test-mode OAuth can limit eligible users or token lifetime]** → Treat tester OAuth as development access, not a public launch configuration.
- **[Location strings are not real travel-time estimates]** → Explain the heuristic in the product and avoid claiming an exact travel time.
- **[Custom signed sessions and service-role database access increase server responsibility]** → Validate role/ownership on every route, keep keys server-only, and add logout/revoke/delete flows before wider deployment.
- **[Refresh tokens remain stored until revoked or removed]** → Add account disconnection and data deletion before production use.
- **[Google 연결이 나중에 만료되거나 철회될 수 있음]** → 실제 연결로 Calendar 읽기는 확인했지만, 이후 실패할 때도 캘린더 조회 단계의 오류를 사용자에게 안내한다. 후보 계산 및 저장 오류와 구분한다.

## Migration Plan

1. Start Docker Desktop and generate the migration from the declarative schema with `supabase db schema declarative sync --name add_caltalk_core --no-apply`.
2. 생성된 SQL을 검토하고 새 로컬 검증용 DB에서 `supabase db reset --local --no-seed`로 재생성을 확인한다.
3. 앱에 설정된 Supabase 프로젝트를 식별·연결한 뒤 `supabase db push --linked --dry-run --skip-vault`를 검토하고 해당 마이그레이션만 적용한다. 이는 로컬 웹 앱이 사용할 데이터베이스 준비이며 웹 앱 배포는 필요하지 않다.
4. 로컬 환경 변수와 localhost OAuth 콜백을 설정하고 Google 테스트 계정으로 소유자 연결부터 확인한다. 이어서 공유 링크로 요청자 연결과 Calendar 조회를 검증한다.

## Open Questions

- The 14-day horizon and weekday 09:00–20:00 `Asia/Seoul` window are the agreed MVP defaults. A later change may make these configurable.
- The wider product may add owner approval and event creation after candidate review; these actions are outside this MVP change and are not implemented here.
