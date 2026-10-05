# Why

로그인마다 Google 권한 동의를 반복하는 불편을 줄이고, 요청자가 캘린더 접근 권한을 주지 않아도 가능한 시간을 선택할 수 있게 한다.

# What Changes

- Supabase Auth 이메일·비밀번호 Caltalk 계정, 유지되는 로그인 세션, 로그아웃 및 Google 연결 관리 화면을 추가한다.
- OAuth 동의를 완료한 Google 계정만 Caltalk 계정에 연결하며 기존 링크와 요청을 보존한다.
- 기존 Google 자동 비교 요청을 유지하고 회원가입·Google 연결 없이 공개된 후보 1–3개를 직접 선택하는 요청을 추가한다.
- 수동 요청은 호스트에게 캘린더·이메일 소유 여부 미확인을 표시하며 호스트 승인 전에는 확정하지 않는다.

# Capabilities

## New Capabilities

- `caltalk-accounts`: 이메일 계정, 세션, 연결 재사용과 재연결.
- `manual-meeting-requests`: 공개 후보 직접 선택과 승인 흐름.

## Modified Capabilities

- `meeting-scheduling`: 자동 캘린더 비교 외에 수동 요청 경로를 허용한다.
- `meeting-approval`: 수동 요청은 호스트 캘린더만 재검사한다.

# Impact

Next.js 로그인·계정·요청 UI, Supabase Auth, owner_calendars.account_id, meeting_requests.request_mode 및 nullable requester_calendar_id, Google OAuth 연결 처리, 수락 API에 영향이 있다. DB 마이그레이션과 공개 API 키 환경 변수가 필요하다. 이메일 인증을 유지하며 인증 메일 발송 설정 및 리디렉션 주소가 필요하다. 사용자 요청에 따라 문서 작성과 구현을 함께 진행한다.
