# Context

현재 서명된 caltalk_session 쿠키는 Google 역할별 로그인만 제공하고 OAuth 시작에 prompt=consent가 고정되어 있다. 소유자 Google 토큰은 owner_calendars, 요청자는 링크별 requester_calendars에 저장된다. 수락은 반드시 두 연결을 조회하므로 수동 경로를 분리해야 한다.

# Goals / Non-Goals

- 목표: Caltalk 재로그인 시 기존 Google 연결 재사용, 호스트와 요청자 겸용 계정, 무연동 수동 후보 선택.
- 제외: 이메일 소유권 미확인을 검증 완료로 취급하기, Google 동의 우회, 사용자 요청 없는 실제 초대 발송 검증, 공휴일·지도·LLM 확장.

# Decisions

1. Supabase Auth가 이메일·비밀번호와 인증 메일을 처리한다. @supabase/ssr와 Next.js proxy가 HttpOnly 쿠키 세션을 갱신하며 서버는 getUser로 사용자 신원을 검증한다. 서비스 키로 DB를 조회하는 클라이언트와 공개 키 기반 Auth 클라이언트를 분리한다.
2. owner_calendars에 auth.users 외래키 account_id를 추가하고 양방향 한 계정/한 Google 연결을 유지한다. OAuth state에 시작한 Caltalk account ID를 넣고 콜백 시 동일 계정인지 확인한다. Google에서 확인된 sub·검증된 이메일만 저장한다. DB RPC가 기존 연결의 소유권과 동시 연결을 확인하며 다른 Caltalk 계정의 연결을 덮어쓰지 않는다. 이메일 문자열 일치로 이전하지 않는다.
3. 계정 연결은 기존 google_sub 행에 매핑해 링크 기록을 보존한다. 계정 로그인 시 예전 역할 쿠키를 지우고 계정 연결로 소유자 화면 및 요청 링크에 접근한다. 로그인·로그아웃·가입은 Origin을 검증한다. 기존 Google 방식은 호환을 위해 유지한다.
4. 자동 요청은 현재 인증한 연결을 링크별 requester_calendars에 재사용하고 호스트/요청자 역할을 전환하기 위해 매번 동의를 요청하지 않는다. 권한 확장·만료 시에만 명시적인 재연결 경로를 제공한다. Google 테스트 모드의 토큰 만료는 별도 제약이다.
5. 수동 요청 페이지는 유효한 공유 코드로 공개된 시간만 조회한다. 최신 호스트 일정과 장소 여유를 반영하며 신규 링크의 고정 길이를 서버에서 강제한다. 이전 링크는 기존 길이 선택 및 공개 구간을 유지한다. 제출한 시각은 서버에서 다시 계산한 후보와 비교하며 과거·범위 밖·닫힌 링크 요청을 거부한다.
6. 수동 요청은 request_mode=manual, requester_calendar_id=null이다. 자동 요청은 기존 값 google과 연결 ID를 유지한다. DB CHECK로 두 상태의 혼합을 차단한다. 호스트 화면에 수동·캘린더/이메일 소유 미확인 표시를 제공한다. 수락 시 호스트 일정만 다시 확인하며 기존 예약 잠금·재시도·Google 초대를 재사용한다.

# Risks / Trade-offs

- 인증 메일은 Supabase 기본 발송 제한과 SMTP 설정에 영향을 받는다. 인증을 임의로 해제하거나 관리자 API로 우회 가입하지 않는다.
- 수동 이메일은 자기 신고값이다. 제출 자체로 초대는 전송하지 않으며 호스트가 명시적으로 수락한다.
- 로컬과 배포는 같은 기존 DB를 사용한다. 스키마 변경은 기존 행과 호환되고 먼저 적용한다.

# Migration Plan

선언형 SQL을 수정하고 pg-delta로 마이그레이션을 생성·검토한다. 로컬 재생성 및 연결된 프로젝트 dry-run 후 적용한다. 기존 자동 요청은 기본 google 값을 받으며 외래키를 유지한다. 기존 Google 연결의 account_id는 null로 시작하고 본인 OAuth 성공 시 연결한다. 공개 Auth 키와 이메일 복귀 URL 설정 후 앱을 배포한다.

# Implementation Record

2026-10-05: 로컬 Docker 엔진이 Windows 런타임 소켓 접근 오류로 시작되지 않아 pg-delta sync 및 db reset을 수행하지 못했다. 선언형 SQL을 기준으로 `migration new`로 만든 `20261005014404_accounts_and_manual_requests.sql`에 호환 ALTER 및 RPC를 작성하고 검토했다. 식별된 기존 원격 프로젝트에 dry-run 후 적용하고 컬럼·RLS를 조회했다. 마이그레이션을 자동 생성했거나 로컬 재구성을 검증했다고 간주하지 않는다.

Vercel 배포 및 Auth 공개 키, Site URL, 인증 복귀 주소 설정을 완료했다. 이메일 인증은 유지하며 일반 팀원 가입용 SMTP가 외부 설정으로 남아 있다. 실제 가입·메일·Google 초대 발송은 수행하지 않았다.
