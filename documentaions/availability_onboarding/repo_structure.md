# Repo Structure — AI 온보딩과 개인 미팅 프로필

작성일: 2026-10-04 · 상태: 확정 (2026-10-04)

기준: [Technical Architecture](technical_architecture.md), [Frontend Architecture](frontend_architecture.md), [Backend Architecture](backend_architecture.md), [Implementation Plan](implementation_plan.md).

이 문서는 기존 `mvp/`에 기능을 확장할 때의 파일 배치와 의존 방향을 정한다. 아래 구조는 **구현 완료 후의 목표 구조**이며 아직 존재하지 않는 경로도 포함한다. 지금은 문서만 작성하며 폴더 이동·제품 코드·DB·라이브러리를 변경하지 않는다.

## 1. 최상위 배치

```text
mvp/
├─ README.md                        # 실행 방법·모드·문서 진입점
├─ AGENTS.md                        # 저장소 작업 지침
├─ CLAUDE.md                        # 기존 도구별 작업 지침
├─ docs/
│  ├─ *.md                         # 기존 MVP 문서와 검증 기록 유지
│  └─ availability_onboarding/      # 이번 확장의 기획·설계·진행 기록
├─ src/
│  ├─ app/                         # 페이지·레이아웃·API 진입점
│  ├─ components/                  # 화면 구성·로컬 상태·API 클라이언트
│  ├─ contracts/                   # 공용 DTO·입력·오류 스키마 [추가]
│  ├─ core/                        # 순수 계산·도메인 타입
│  ├─ llm/                         # 모델 호출·해석·제안·응답
│  └─ server/                      # 인증·외부 연결·저장·서비스
├─ tests/
│  ├─ core/                        # 구간·슬롯·분석·상속·순위
│  ├─ contracts/                   # 공용 계약 검증 [추가]
│  ├─ llm/                         # 구조 검증·재시도·fallback
│  ├─ server/                      # 저장·권한·서비스·경합·이전
│  ├─ components/                  # DOM·상태·사용자 조작 [추가]
│  └─ fixtures/                    # 합성 공급자/legacy/흐름 자료 [추가]
├─ scripts/                        # reset·migration·모델 평가
├─ data/                           # 로컬 DB·백업, 버전 관리 제외
├─ .env                            # 실제 환경값, 버전 관리 제외
├─ .env.example                    # 필요한 설정 이름과 안전한 예시
├─ .gitignore
├─ package.json · package-lock.json
├─ tsconfig.json · vitest.config.ts
└─ next.config.ts · postcss.config.mjs
```

`src/`, `tests/`, `scripts/`와 도구 설정은 기존 프로젝트를 사용한다. 모노레포·별도 API 서버·공용 패키지를 만들지 않는다. 기존 `@/* → ./src/*` 별칭을 유지한다. `node_modules/`, `.next/`, `next-env.d.ts`, TypeScript 빌드 캐시는 생성물이며 소스 트리에 복제하지 않는다.

기존 Repo Structure에 예시로 적힌 `drizzle.config.ts`는 현재 파일 목록에 없다. 이번 계획은 `server/db/migrate.ts`와 명시적 migration을 사용하므로 이 파일을 이미 있는 것으로 취급하거나 별도 도구 설정을 자동 추가하지 않는다.

## 2. 문서의 위치와 기준

이번 확장은 한 폴더에 다음 순서로 보관한다. 문서의 승인 상태와 제품 구현 완료 상태는 별개다.

| 문서 | 책임 |
|---|---|
| [one_pager.md](one_pager.md) | 문제·가치·첫 버전 범위 |
| [product_requirement_document.md](product_requirement_document.md) | FR·NFR·AC와 제품 정책 |
| [user_stories.md](user_stories.md) | 사용자 역할·상황·기대 결과 |
| [user_flow.md](user_flow.md) | F01–F11의 진행·실패·복귀 |
| [app_screen_list.md](app_screen_list.md) | S0–S13의 화면 책임 |
| [technical_architecture.md](technical_architecture.md) | 기술 경계와 AD-01–AD-10 |
| [frontend_architecture.md](frontend_architecture.md) | 화면 상태·URL·서버 계약 사용 |
| [backend_architecture.md](backend_architecture.md) | 저장 모델·API·동시성·실패 처리 |
| [implementation_plan.md](implementation_plan.md) | M0–M6·T01–T16의 순서와 검증 기준 |
| [repo_structure.md](repo_structure.md) | 위 설계의 파일 배치·의존 방향 |

`validation_report.md`는 T16에서 실제 검증 결과를 기록할 때 생성한다. 예상 결과만 담은 완료 보고서를 미리 만들지 않는다. 기존 `docs/implementation_plan.md`의 이전 MVP 완료 기록은 그대로 보존한다.

제품 동작은 PRD, 상세 인터페이스는 각 아키텍처, 작업 순서는 Implementation Plan을 따른다. 이 문서로 새로운 제품 규칙이나 API를 추가하지 않는다. 기존 MVP 문서는 유지하되 이번 확장에서 바뀐 항목은 확장 문서의 명시적 변경 계약을 적용한다. 모순을 발견하면 해당 결정 문서를 수정하고 참조 문서와 맞춘다.

같은 폴더 문서 간에는 상대 링크를 쓴다. 코드·프레임워크 가이드 링크는 이 폴더에서 실제 위치까지 계산한다. 예를 들어 `mvp/node_modules/`는 여기서 `../../node_modules`다. README의 기능 문서 진입점은 구현 작업에서 이 폴더로 연결한다.

## 3. 화면과 라우트

다음 경로는 `src/app/` 기준이다. `(public)`, `(app)`은 URL에 포함되지 않는 route group이다. 기존 루트 layout을 유지하고 보호 영역에 공통 Header를 옮긴다. 설치된 Next.js의 [Route Groups 가이드](../../node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md)를 기준으로 같은 URL에 페이지가 중복되지 않도록 이동한다.

| 파일 | URL·책임 | 작업 |
|---|---|---|
| `layout.tsx`, `globals.css` | 공통 문서 뼈대·스타일. 인증을 전제한 Header 제외 | T05 |
| `page.tsx` | `/`: 세션·설정 상태를 읽고 진입 분기 | T05·T06 |
| `(public)/login/page.tsx` | `/login`: 실제 로그인 시작·취소·복귀 | T06 |
| `(app)/layout.tsx` | 보호된 영역의 Header·설정 상태 안내 | T05·T06 |
| `(app)/calendar/page.tsx` | `/calendar`: 기존 페이지 이동·일정/근거 패널 연결 | T05·T10 |
| `(app)/settings/availability/page.tsx` | `/settings/availability`: 확정 프로필·초안 진입 | T05 |
| `(app)/settings/host/page.tsx` | `/settings/host`: 기존 호스트 설정·준비 상태 | T05·T14 |
| `(app)/settings/calendars/page.tsx` | `/settings/calendars`: 연결·선택·조회·해제 | T10 |
| `(app)/onboarding/page.tsx` | `/onboarding?draft=…`: 초안 편집·대화 | T05·T10 |
| `(app)/onboarding/review/page.tsx` | `/onboarding/review?draft=…`: 최종 확인 | T05·T10 |
| `(app)/book/page.tsx` | `/book`: 호스트 목록 | T05·T14 |
| `(app)/book/[hostId]/page.tsx` | 상대 진입: 기존 탐색 이어가기·새 탐색 선택 | T05·T14 |
| `(app)/book/[hostId]/search/[searchId]/page.tsx` | 정확한 탐색·조건·메시지 복원 | T14 |
| `(app)/requests/sent/page.tsx` | `/requests/sent`: 보낸 요청·철회·충돌 | T05·T14 |
| `(app)/requests/inbox/page.tsx` | `/requests/inbox`: 받은 요청·수락·거절 | T05·T14 |

S6 요청 모달은 예약 Workspace 안에, S13 원본/근거 상세는 호출 화면의 패널에 둔다. 독립 페이지를 추가하지 않는다. 로딩·렌더 오류 경계 파일은 해당 route 영역에 두고 command 실패는 화면 상태로 처리한다. 페이지 렌더에서 초안·탐색·메시지를 만들지 않는다.

API는 route group 밖 `src/app/api/`를 유지한다. Backend §5의 `/api/…`마다 같은 상대 경로의 `route.ts`를 둔다. 예를 들어 `/api/profile-drafts/[id]/confirm`은 `src/app/api/profile-drafts/[id]/confirm/route.ts`다. 쿼리 문자열은 폴더가 아니므로 operation ID 없는 조회도 `api/operations/route.ts`에서 처리한다.

| API 경로군 | 담당 서비스 | 작업 |
|---|---|---|
| `auth/google/start`, `auth/google/callback`, `auth/logout`, `me` | `auth`, `session` | T06 |
| `calendar-connection` 및 하위 작업, `calendar-use-decision` | `calendar-sync` | T08 |
| `imported-events/[id]`, 그 하위 `annotation` | `event-annotations`·원본 조회 | T08 |
| `analysis-evidence/[id]` | `analysis` | T09 |
| `profile`, `profile-drafts` 및 current·조회·편집·confirm | `profile` | T04 |
| `profile-drafts/[id]/analysis`, `profile-drafts/[id]/turns` | `analysis`, `onboarding` | T09 |
| `hosts`, `hosts/[id]/booking-entry`, `booking-searches` 및 하위 작업 | `search` | T12 |
| `requests` 및 accept-preview·accept·decline·withdraw | `booking`, `accept-impact` | T13 |
| `operations`, `operations/[id]` | `operations` | T03·T06 |
| 기존 `events`, `places`, `meeting-types`와 ID별 경로 | 기존 저장소·공용 작업/권한 경계 | T06·T13 |

기존 `api/session`은 데모 전용 사용자 전환으로 남긴다. `api/availability`의 직접 확정 우회 경로와 `api/conversations`는 호출부 전환 후 제거한다. T12–T14 전환 중 어댑터가 필요해도 신규 서비스에 위임하며 별도 쓰기 구현을 유지하지 않는다.

## 4. 화면 컴포넌트 배치

기존 공용 컴포넌트는 `src/components/`에 유지한다. 기능별로 새로 생기는 화면 상태와 편집기를 하위 폴더로 묶는다. 다음 표의 파일명은 각 폴더 기준이며 구현 계획에서 정한 위치를 따른다.

| 폴더 | 주요 파일 | 책임 |
|---|---|---|
| `src/components/` | 기존 `api.ts`, `Header.tsx`, `UserSwitcher.tsx`, `EventForm.tsx`, `HostSettings.tsx`, `RequestModal.tsx`, `OptionButtons.tsx`, `InboxGroup.tsx`, `SentRequests.tsx` | 공용 API 클라이언트·기존 화면 기능 확장 |
| `src/components/hooks/` | `useMutationOperation.ts`, `useEntryOperation.ts` | 작업 키·응답 유실 복구·명시적 진입 작업 |
| `src/components/onboarding/` | `OnboardingWorkspace.tsx`, `ProfileEditor.tsx`, `WeeklyWindowsEditor.tsx`, `PreferenceEditor.tsx`, `ProfileSummary.tsx` | 초안 편집·확정값 표시 |
| 같은 폴더 | `draftReducer.ts`, `useDraftAutosave.ts` | 저장 snapshot·dirty 입력·500ms 순차 저장 |
| 같은 폴더 | `OnboardingChat.tsx`, `EvidencePanel.tsx`, `WeekSchedule.tsx` | 대화·근거·주간표 |
| `src/components/calendar/` | `CalendarConnectionManager.tsx`, `EventDetailsPanel.tsx`, `EventAnnotationForm.tsx` | 연결·원본/보완·확인 상태 |
| `src/components/booking/` | `SearchEntry.tsx`, `BookingWorkspace.tsx`, `PreferenceChips.tsx`, `MeetingTypePicker.tsx`, `AcceptConfirmation.tsx` | 탐색 진입·이번 조건·요청/수락 흐름 |

`WeekSchedule.tsx`는 계획대로 onboarding 폴더에 한 번 구현하고 내 캘린더에서도 같은 표시 컴포넌트를 사용한다. 이 컴포넌트가 온보딩 Workspace의 저장 상태를 직접 읽게 하지 않고 props로 자료를 받게 한다. `RequestModal`의 메시지는 부모 `BookingWorkspace`가 소유한다. reducer는 해당 기능 폴더에 두며 전역 store를 만들지 않는다.

기존 `AvailabilityForm.tsx`, `ChatView.tsx`, `FilterChips.tsx`는 대응 화면을 전환하면서 필요한 부분을 사용한다. 호출부가 사라진 뒤 남는 파일만 정리한다. 기존 컴포넌트 전체를 미리 이동하거나 이름만 바꾸는 작업을 추가하지 않는다.

## 5. 계약·계산·모델의 경계

| 위치 | 파일·책임 |
|---|---|
| `src/contracts/` | `common.ts`, `auth.ts`, `calendar.ts`, `profile.ts`, `search.ts`, `booking.ts`, `operations.ts`: API 입력·view·오류·작업 상태 |
| `src/core/` 기존 | `types.ts`, `time.ts`, `availability.ts`, `travel.ts`, `slots.ts`, `filter.ts`, `summary.ts`, `options.ts`, `booking.ts`, `chips.ts`, `explain.ts` |
| `src/core/` 추가 | `profile.ts`: 프로필 값·구간 검증, `calendar.ts`: 공급자에서 투영한 자료의 정규화, `analysis.ts`: 빈도·분포, `preferences.ts`: 상속·override·disabled 합성 |
| `src/llm/` 기존 | `ollama.ts`: 호출·시간 제한, `interpret.ts`: 예약 조건 해석, `respond.ts`: 계산 근거 설명 |
| `src/llm/` 추가 | `classify.ts`: 분류 제안, `onboarding.ts`: 설정 발화 해석·질문/제안 |

프로필 값은 `core/profile.ts`, 시간 범위는 `core/time.ts`, 탐색 조건과 순위 타입은 `core/types.ts`가 소유한다. 화면 DTO는 contracts에 두며 DB 행 타입을 그대로 브라우저에 전달하지 않는다. DB 행·토큰·OAuth 응답의 타입은 server 내부에 둔다.

Google 원문 스키마 검증은 provider 어댑터에서 수행한다. `core/calendar.ts`는 어댑터가 만든 공급자 독립 입력을 받아 busy·travel anchor·분석 자료를 계산하며 Google SDK·HTTP·환경변수에 의존하지 않는다. 모델 출력 검증 스키마는 해당 llm 모듈에 두고 API 입력 스키마와 혼동하지 않는다.

## 6. 서버와 DB 배치

다음 파일은 `src/server/` 기준이다. 현재 server가 데모용인 부분은 실제 인증·연결 서비스로 확장하며 별도 서버 패키지로 옮기지 않는다.

| 경로 | 책임 | 작업 |
|---|---|---|
| 기존 `context.ts` | 실제 실행의 DB·모델·현재 사용자 접근을 조립하는 경계. 세션 정책은 session으로 위임 | T02·T06 |
| `runtime.ts`, `config.ts` | ServiceContext·clock/ID/어댑터 주입·실제/데모 설정 검증 | T02 |
| `session.ts`, `token-vault.ts` | 사용자 세션·토큰 암호화. 공급자 인증과 앱 세션을 구분 | T06 |
| 기존 `api.ts`, `log.ts` | 공용 오류 변환·안전한 구조화 로그 | T03·T06 |
| `providers/google-auth.ts`, `providers/google-calendar.ts` | 외부 인증·토큰 갱신·Calendar 호출/원문 검증 | T06·T08 |
| 기존 `db/schema.ts`, `db/client.ts`, `db/ddl.ts`, `db/seed.ts` | 스키마 타입·연결·테스트/신규 스키마·데모 시드 | T02 |
| `db/migrate.ts`, `db/migrations/001-availability-onboarding.ts` | 순서 있는 migration·checksum·legacy 변환 | T02·T15 |
| 기존 `repos/users.ts`, `events.ts`, `hosting.ts`, `requests.ts` | 기존 자료 접근·새 revision/저장 표현 반영 | T02·T13 |
| `repos/operations.ts`, `profiles.ts`, `calendars.ts`, `analyses.ts`, `searches.ts` | 작업·프로필·외부 자료·분석·탐색의 저장 경계 | T03·T04·T08·T09·T12 |
| `services/auth.ts`, `operations.ts`, `profile.ts` | 인증 흐름·작업 수명·초안/확정 | T03·T04·T06 |
| `services/calendar-sync.ts`, `event-annotations.ts` | 전체 조회·snapshot 교체·원본 보완·해제 | T08 |
| `services/analysis.ts`, `onboarding.ts` | 코드 집계·모델 제안·초안 CAS | T09 |
| `services/search.ts`, 기존 `schedule.ts` | 탐색·첫 응답·조건 변경·계산 입력 조립 | T07·T12 |
| 기존 `services/booking.ts`, `services/accept-impact.ts` | 최신 조회 후 요청/수락·자동 거절 영향 확인 | T13 |

기존 `repos/conversations.ts`, `services/chat.ts`는 T02·T12의 전환 경계다. search 서비스 전환이 끝나면 중복 저장 책임을 제거한다. read model은 해당 도메인 서비스에 두고 Route Handler·서버 페이지가 같은 조회 함수를 사용한다. 별도 조회 서비스 계층을 선제적으로 추가하지 않는다.

DDL·Drizzle schema·migration은 같은 최종 구조를 표현해야 한다. 신규 DB 생성과 legacy 이전을 테스트에서 대조하며, 시작할 때 임의로 테이블을 drop/recreate하지 않는다. 이미 적용한 migration은 checksum으로 식별하고 이후 수정은 새 순번 migration으로 처리한다. T02에서 migration을 작성하는 것과 실제 사용자 DB에 적용하는 것은 별도 작업이다.

## 7. Import 방향

| 소비하는 쪽 | 허용하는 앱 내부 의존성 | 경계 |
|---|---|---|
| Client Component·브라우저 훅 | contracts, 표시/폼 검증에 필요한 순수 core, 다른 표시 컴포넌트 | server·DB·provider·llm 실행 코드 import 금지 |
| 서버 페이지·Route Handler | session, 도메인 서비스, contracts | 페이지는 read model 조회, 변경은 명시적 command |
| contracts | core 타입·순수 검증 | server·llm·Next.js 의존 없음 |
| core | core 내부 | I/O·환경변수·공급자 SDK·contracts·UI 의존 없음 |
| llm | core 계약, 자체 모델 호출 어댑터 | DB·Calendar·프로필/예약 저장 호출 없음 |
| services | contracts, core, llm, providers, repos, 공통 작업 경계 | UI·route 파일 import 없음 |
| repos·db | DB 연결·schema, 필요한 core 저장 변환 | 서비스 orchestration·외부 호출 없음 |
| providers | 공급자 라이브러리·내부 어댑터 타입·필요한 core 입력 타입 | UI·도메인 서비스의 역방향 호출 없음 |

`runtime.ts`는 구성된 의존성을 서비스에 전달하고 서비스는 주입된 clock·provider를 사용한다. 토큰 조회·갱신 결과 저장은 서비스가 조정하고 provider는 공급자 교환을 수행해 service↔provider 순환을 피한다. 브라우저에서 API를 호출한다는 이유로 server 모듈을 import하지 않는다.

## 8. 테스트·스크립트·실행 자료

| 위치 | 내용·검증 경계 |
|---|---|
| `tests/core/` | 기존 계산 회귀 + profile·calendar·analysis·preferences. DB·네트워크 없이 고정 시각 사용 |
| `tests/contracts/inputs.test.ts` | API 입력·지원 범위·오류/view 스키마 |
| `tests/llm/` | 기존 fetch 목 테스트 + onboarding. 실제 모델 평가는 별도 스크립트 |
| `tests/server/` | 기존 booking/chat/log + migration·operations·profile·auth·sync·annotations·onboarding·search·예약 경합·이전 리허설·전체 흐름 |
| `tests/components/` | `profile-editor.test.tsx`, `calendar-onboarding.test.tsx`, `booking-workspace.test.tsx`, `setup.ts` |
| `tests/fixtures/` | `legacy-db.ts`, `google-events.ts`, `onboarding-scenarios.ts`: 합성 자료·명시적 기대값 |
| 기존 `scripts/db-reset.ts` | 데모/테스트 전용 초기화. 실제 모드 차단 |
| 추가 `scripts/db-migrate.ts` | 일관된 백업·migration·진단·복원 경로 |
| 기존 `scripts/eval-interpret.ts` | 예약 발화의 실제 모델 평가 |
| 추가 `scripts/eval-onboarding.ts` | 온보딩 해석·근거·지연·fallback 실측 |

Vitest 설정은 `tests/**/*.test.ts`와 `.test.tsx`를 수집하고 DOM 환경은 컴포넌트 테스트에만 적용한다. 기존 `tests/core/helpers.ts`, `tests/server/helpers.ts`는 유지·확장하고 새 provider fixture를 서버 공용 helper에 무분별하게 섞지 않는다. 실제 개인 일정·인증 토큰은 fixture로 저장하지 않는다.

writer 경합·WAL·백업 검증은 임시 파일 DB를 사용하며 테스트 종료 시 닫고 정리한다. 실제 계정 DB 경로를 테스트 기본값으로 사용하지 않는다. 테스트용 메모리 DB의 성공과 실제 Google·브라우저 검증은 T16 보고서에서 구분한다. 별도 브라우저 테스트 도구 도입은 현재 계획에 포함하지 않으며 실제 조작 검증 기록을 남긴다.

`data/` 아래 DB·WAL/SHM·백업은 버전 관리에서 제외한다. 실제/데모 DB 경로는 설정에서 분리하며 파일명 예시가 기본 실사용 DB의 자동 변환을 뜻하지 않는다. 환경값 변형 파일을 사용할 경우 구현 시 `.env.example`만 추적되도록 ignore 규칙을 확인한다. 비밀값과 원본 자료를 docs·public 디렉터리·평가 출력에 복사하지 않는다.

## 9. 적용과 검토 완료 기준

- 파일 이동은 T05·T14에서 호출부와 함께 수행한다. route group 안팎에 동일 URL의 페이지를 동시에 남기지 않는다.
- 타입·API·도메인 규칙을 새로운 폴더마다 복제하지 않는다. 경계 변경 시 소유 파일과 소비 작업을 함께 확인한다.
- 기존 기능의 참조가 끊긴 전환 어댑터만 정리한다. 사용자 자료·이전 MVP 문서·미완료 사용자 변경은 보존한다.
- 실제 구현 검증은 Implementation Plan의 테스트·typecheck·build·실제 연동 기준을 따른다. 폴더가 생겼다는 이유로 기능 작업을 완료 처리하지 않는다.

이 문서까지 검토하면 이번 기능의 기획·설계 문서 10종이 갖춰진다. 이후에는 Implementation Plan의 **M0/T01부터 구현 단계**로 넘어갈 수 있다. 2026-10-04 검토 후 구조를 확정했고 Implementation Plan의 M0 구현을 시작했다.
