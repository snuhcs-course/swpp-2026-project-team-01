# Caltalk OpenSpec

현재 동작은 `specs/`를 기준으로 읽습니다. 변경의 배경·설계·작업 기록은 `changes/`에 보관합니다. 문서는 앱 코드와 같은 Git 저장소 및 브랜치에서 관리합니다.

## Current Specifications

| 사양 | 내용 |
| --- | --- |
| [meeting-scheduling](specs/meeting-scheduling/spec.md) | Google 연결, 양쪽 캘린더 비교, 후보와 확정의 구분 |
| [owner-calendar-view](specs/owner-calendar-view/spec.md) | 소유자 주간 캘린더, 규칙 기반 가능 시간, 조건 안내 |
| [request-link-management](specs/request-link-management/spec.md) | 이름·주소·상세·열기/닫기·삭제 및 기존 링크 호환 |
| [selected-slot-links](specs/selected-slot-links/spec.md) | 호스트의 범위·길이 설정, 후보 최대 5개 중 최소 2개 선택 |
| [meeting-approval](specs/meeting-approval/spec.md) | 수락, 쓰기 권한 동의, Google 등록·초대 요청, 중복 방지·복구 |

## Current Decisions

- Next.js 웹 앱은 로컬 개발과 Vercel 팀원 테스트 배포를 함께 사용하며 기존 개인 Supabase 프로젝트를 공유합니다. 테스트 주소는 https://caltalk-mvp.vercel.app 이며 Google 배포 리디렉션 URI 등록을 완료했습니다. 주소 불일치 오류 해소를 확인했으며 실제 로그인 이후의 전체 미팅 흐름 확인은 남아 있습니다. 배포 설정과 남은 작업은 [팀원 테스트 배포 안내](../documentaions/team-test-deployment.md)를 따릅니다.
- Google Calendar 연동을 우선합니다. 시간 추천은 규칙 기반이며 LLM은 연결하지 않았습니다.
- 기본 범위는 서울 시간 기준 내일부터 14일, 평일 09:00–20:00입니다. 새 링크에서 범위를 좁힐 수 있습니다.
- 새 링크의 길이는 호스트가 결정하며 선택한 정확한 시간만 공개합니다. 이전 링크는 기존 동작을 유지합니다.
- 호스트가 후보 하나를 명시적으로 수락할 때만 Google 일정 생성과 초대 알림을 요청합니다. 기존 호스트는 쓰기 권한 추가 동의가 필요합니다.

## Implementation and Verification Status

2026-10-05 기준 캘린더 화면·링크 관리·호스트 후보 선택·수락 및 초대 API 구현과 Supabase 마이그레이션 적용을 완료했습니다. 타입 검사, lint, Next.js 빌드는 이전 구현 턴에서 통과했습니다.

초기 Google 연결과 양쪽 일정 조회·요청 저장은 실제 연결로 확인했고, 사용자가 요청 제출 성공을 확인했습니다. 새 화면 전체의 브라우저 조작, 추가 쓰기 권한 동의, 실제 Google 일정 생성 및 초대 이메일 수신은 아직 검증하지 않았습니다. 구현 완료와 실제 발송 검증을 구분합니다. 초기 변경의 전체 브라우저 검증 작업은 미완료로 남깁니다.

변경 기록은 아직 보관 처리(archive)하지 않았습니다. 후속 변경을 반영한 delta 사양과 최신 사양을 함께 동기화했으며, 초기 proposal/design의 당시 범위는 후속 변경 안내와 함께 보존합니다.

## 계정 및 수동 요청 추가

- [caltalk-accounts](specs/caltalk-accounts/spec.md): 이메일 계정, 세션 갱신, Google 연결 재사용과 소유권 검증.
- [manual-meeting-requests](specs/manual-meeting-requests/spec.md): 가입·캘린더 연결 없이 공개 후보 선택, 수동 요청 표시와 호스트 일정 재검사.
- 변경 기록: `changes/persistent-accounts-and-manual-requests/`. 현재 사양에는 새 동작을 동기화했습니다. 과거 변경 기록보다 현재 사양과 이 후속 변경이 우선합니다.
- 구현·원격 마이그레이션 적용·Vercel 배포 및 정적 검사는 완료했습니다. 일반 팀원 가입용 SMTP, 실제 인증·초대 흐름 확인, Docker 복구 후 로컬 DB reset은 남아 있어 변경을 archive하지 않습니다.
