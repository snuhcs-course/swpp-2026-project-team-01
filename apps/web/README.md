# Caltalk · 일정 조율 도우미

외부 미팅이 잦은 직장인을 위한 Next.js 앱입니다. 요청 링크를 통해 상대방이 Google Calendar를 연결하고 미팅 목적, 소요 시간, 장소를 입력하면 양쪽 캘린더의 겹치는 시간과 이동 여유를 고려해 후보 2–3개를 저장합니다. 일정은 소유자가 확인하기 전까지 확정되지 않습니다.

## Run locally

Requirements: Node.js 20.9 or later and pnpm.

```bash
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

Open <http://localhost:3000>.

## Configuration

Create a Supabase project, then apply `supabase/schemas/caltalk.sql` through the repository's declarative schema workflow. Create a Google OAuth client of type **Web application**, enable Google Calendar API, and register `http://localhost:3000/api/auth/google/callback` as an authorized redirect URI. While the OAuth consent screen is in testing, add each tester's Google account as a test user.

Set the variables shown in `.env.example` in `.env.local`. `SUPABASE_SECRET_KEY` and `GOOGLE_CLIENT_SECRET` are server-only secrets; never use a `NEXT_PUBLIC_` prefix or commit `.env.local`. Generate the session and encryption keys with a cryptographically secure random generator. Configure the deployed app's matching production URL in `APP_URL` and as an additional Google redirect URI.

The app asks both users for read-only calendar-event access. It stores encrypted refresh tokens, hashes share codes, and requests only event start/end/location fields. It does not read event titles or attendees and does not create or confirm events. Location buffers are a simple heuristic (same/unknown location 15 minutes; different physical location 45 minutes; online-to-online 0 minutes), not a travel-time estimate.

## Checks

```bash
pnpm lint
pnpm build
```
