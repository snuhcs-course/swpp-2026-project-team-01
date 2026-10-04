# Caltalk · 일정 조율 도우미

외부 미팅이 잦은 직장인을 위한 Next.js 앱입니다. 요청 링크를 통해 상대방이 Google Calendar를 연결하고 미팅 목적과 장소를 입력하면 양쪽 캘린더의 겹치는 시간과 이동 여유를 고려해 가능한 후보를 최대 3개 저장합니다. 소유자가 후보 하나를 수락하면 Google Calendar에 등록하고 요청자 초대를 발송하도록 Google에 요청합니다.

후보는 서울 시간 기준 내일부터 14일 동안의 평일 09:00–20:00에서 검색하며, 미팅 전체가 이 시간 범위 안에 들어가야 합니다. 후보 날짜의 요일과 표시 시각도 서울 시간을 따릅니다. 요청 실패 시 캘린더 조회, 후보 계산, 저장 중 실패한 단계에 맞는 안내를 표시합니다.

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

Requesters grant read-only calendar-event access. Owners additionally grant `calendar.events.owned` to create events on their own calendar after explicit approval. Existing owners must reconnect once and approve this additional permission. No Gmail scope or extra email service is required. It stores encrypted refresh tokens and hashes share codes. New links also store an encrypted copy of the code so the owner can copy the URL again. Scheduling reads event start/end/location and busy/free state. The owner's private calendar view additionally reads titles, event IDs and all-day state; titles are not stored or exposed to requesters. Existing event attendees are not read. The app creates events only through the owner approval endpoint; it passes the stored requester email as an attendee and `sendUpdates=all`. Location buffers are a simple heuristic (same/unknown location 15 minutes; different physical location 45 minutes; online-to-online 0 minutes; online-to-physical 15 minutes), not a travel-time estimate.

## Owner home and request links

로그인 후 `/owner`에서 기본 Google Calendar의 주간 시간표를 확인합니다. 파란색은 실제 일정, 초록색은 규칙으로 계산한 미팅 가능 시간입니다. 이번 주부터 3주를 볼 수 있으며, 추천 가능 구간은 내일부터 14일 동안의 평일 09:00–20:00입니다. 전후 15분을 확보하고, 시작을 30분 간격에 맞춘 뒤 30분 이상 남는 구간만 표시합니다. Google에서 ‘한가함’으로 지정한 일정은 충돌로 취급하지 않습니다. 공휴일은 별도로 제외하지 않습니다. 실제 AI 모델이나 지도 API는 연결하지 않았습니다.

왼쪽에서 현재 미팅 조건을 확인할 수 있습니다. 조건 및 초록색 블록 편집은 아직 제공하지 않습니다. 일정을 변경했다면 캘린더의 새로고침 버튼을 누릅니다.

### 링크 만들기

1. 이름, 미팅 길이(30/45/60/90/120/180/240분), 공개할 날짜·평일·하루 중 시간 범위를 입력합니다. 기본 조건(내일부터 14일, 평일 09:00–20:00) 안에서 범위를 좁힐 수 있습니다.
2. 최신 내 캘린더에서 해당 길이가 들어가는 후보를 최대 5개 추천받습니다. 후보는 날짜를 분산하고 서로 겹치지 않게 선택합니다. 가능 시간이 부족하면 실제 개수를 안내합니다.
3. 후보 중 2개 이상 선택하면 선택한 정확한 시간만 링크에 저장됩니다. 미리보기는 15분 동안 유효하며 생성 직전에 새 충돌을 다시 확인합니다.
4. 요청자는 호스트가 정한 미팅 길이를 바꾸지 못합니다. 제출 시 선택된 시간 중 양쪽 캘린더와 장소 조건을 만족하는 후보만 저장합니다.

링크 상세에는 작은 주간 시간표와 시간 목록, 요청자, 주소 복사, 열기/닫기/삭제가 표시됩니다. 공개 시간은 자동 연장되지 않습니다. 이전 버전 링크는 기존 구간·요청자 길이 선택 동작을 유지하며, 최초 버전의 해시만 저장된 링크는 URL 재복사를 지원하지 않습니다.

### 요청 수락과 초대

링크 상세의 ‘이 링크로 들어온 요청’에서 후보 하나를 선택하고 **수락하고 초대 보내기**를 누릅니다. 기존 연결은 **일정 등록 권한 연결**을 눌러 같은 호스트 계정으로 추가 동의해야 합니다. 양쪽 최신 캘린더를 다시 확인한 뒤 호스트 기본 캘린더에 일정을 생성하고 요청자 이메일을 참석자로 넣습니다. Google에 모든 참석자의 초대 알림을 발송하도록 요청합니다. 상대 계정의 초대 설정·스팸 분류에 따라 실제 수신과 자동 캘린더 반영은 달라질 수 있으며, 앱은 이메일 배달을 추적하지 않습니다.

중복 클릭은 DB의 소유자별 처리 제한으로 막습니다. 요청 UUID 기반 Google 이벤트 ID를 사용하고, 결과가 불분명하면 **등록 결과 확인 / 재시도**로 기존 일정을 찾아 DB 상태를 복구합니다. 다른 시간이 중복 등록되지 않도록 처리 중인 후보는 고정합니다. 등록된 이벤트가 외부에서 변경/삭제되면 확인 필요 상태로 남기고 자동으로 다시 만들지 않습니다. 외부 Google 편집과 일정 생성 사이의 경쟁까지 원자적으로 막을 수는 없습니다.

링크를 삭제하면 해당 링크와 받은 요청은 목록에서 숨겨지며, 기존 기록은 DB에 보존됩니다. 일시적으로 닫은 링크의 요청은 계속 표시됩니다. 등록 중인 요청이 있는 링크는 먼저 등록 결과를 확인한 뒤 삭제합니다. 실제 초대는 사용자가 수락 버튼을 눌렀을 때만 발송합니다.

### Implementation map

- `app/owner/owner-dashboard.tsx`: 로그인 후 홈, 조건 안내, 데이터 조회.
- `app/owner/calendar-view.tsx`: 주간 그리드, 종일/겹침 일정, 가능 시간.
- `app/owner/link-manager.tsx`: 링크 상세·상태 관리.
- `app/owner/create-link-form.tsx`, `mini-week-calendar.tsx`: 공개 범위·길이·후보 선택 및 작은 주간 시간표.
- `app/owner/request-approval.tsx`: 후보 선택, 수락 및 등록 결과 표시.
- `app/owner/received-requests.tsx`: 기존 받은 요청 표시.
- `lib/availability.ts`, `lib/link-options.ts`: 서울 날짜·빈 시간·공개 조건·호스트 후보 계산.
- `lib/server/link-preview.ts`: 소유자와 후보에 묶인 미리보기 서명.
- `lib/server/google-booking.ts`: Google 일정 조회·생성·초대 알림 요청.
- `lib/server/auth.ts`: Google 조회와 양쪽 캘린더 후보 추천.
- `app/api/share/candidates/route.ts`: 호스트 후보 5개 추천.
- `app/api/requests/[id]/approve/route.ts`: 소유권·중복·충돌 확인 후 수락.
- `app/api/calendar/events/route.ts`: 소유자 본인 캘린더 조회.
- `app/api/share/route.ts`, `app/api/share/[id]/route.ts`: 소유자 한정 링크 관리 API.
- `supabase/schemas/caltalk.sql` (저장소 루트): 링크 상태/공개 구간 및 동시 제출을 막는 DB 트리거.

## Checks

The owner inbox reads `GET /api/requests`, which returns `{ "links": [...] }` for the signed-in owner's non-deleted share links and meeting requests (including paused links). Anonymous and requester sessions receive a JSON `401` error. Database failures return a JSON `500` error, and the dashboard displays an error message instead of crashing on empty or invalid responses.

```bash
pnpm lint
pnpm build
```

## 팀원 테스트 배포

https://caltalk-mvp.vercel.app 에 Vercel CLI로 배포했습니다. 기존 개인 Supabase DB를 로컬 환경과 공유합니다. Google 배포 리디렉션 URI 등록과 실제 로그인 이후 흐름 확인이 남아 있습니다. [배포 설정 및 다음 작업](../../documentaions/team-test-deployment.md)을 참고하세요.
