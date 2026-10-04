# Proposal

## Why

외부 미팅이 잦은 직장인은 상대방과 일정을 여러 차례 주고받으며 시간을 맞춰야 합니다. Caltalk은 양쪽의 실제 Google Calendar 일정을 확인해 일정 소유자가 검토할 후보 시간을 제안함으로써 조율 부담을 줄입니다.

## MVP 우선순위와 실행 범위

- 최우선 목표는 사용자가 자신의 Google 계정으로 로그인해 Google Calendar를 연결하는 흐름을 로컬에서 실제로 확인하는 것이다.
- 개발과 검증은 로컬 웹 앱으로 충분하다. 공개 배포나 운영 서버 개설은 MVP 완료 조건이 아니다.
- 요청 링크, 후보 추천, Supabase 저장은 Google Calendar 연동을 확인하기 위해 필요한 범위에서 진행한다.

## What Changes

- 일정 소유자와 요청자가 각자 Google Calendar를 연결할 수 있는 웹 앱을 제공합니다.
- 일정 소유자는 요청 링크를 만들고 상대방에게 공유합니다.
- 요청자는 링크에서 이름, 미팅 목적, 소요 시간, 장소를 입력해 요청합니다.
- 양쪽 캘린더의 바쁜 시간과 일정 장소를 확인해 후보 2–3개 및 추천 이유를 계산하고, 일정 소유자에게 보여줍니다.
- 요청과 후보를 Supabase에 저장합니다. 캘린더 연결은 읽기 전용이며 일정 생성과 확정은 이 MVP 범위에서 제외합니다.

## Capabilities

### New Capabilities
- `meeting-scheduling`: 공유 링크 기반 외부 미팅 요청, 양쪽 일정 충돌 및 이동 여유 확인, 일정 소유자용 후보 검토 흐름.

### Modified Capabilities

해당 없음. 기존 OpenSpec 기능 사양이 없습니다.

## Impact

- 웹 앱: `apps/web` (Next.js)
- 서버 기능: Google OAuth 연결, 캘린더 일정 조회, 후보 계산 및 요청 저장
- 데이터베이스: Supabase의 캘린더 연결, 공유 링크, 미팅 요청 테이블
- 외부 설정: Google Calendar API, 웹 OAuth 클라이언트, Supabase 프로젝트
