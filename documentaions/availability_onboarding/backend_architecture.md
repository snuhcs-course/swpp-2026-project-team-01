# Backend Architecture — AI 온보딩과 개인 미팅 프로필

> 저장소는 Postgres(Supabase)로 이식되었다. 이 문서의 SQLite 서술은 설계 당시 기준이며 대응은 [postgres_port.md](postgres_port.md)를 본다.

작성일: 2026-10-04 · 상태: 확정 (2026-10-04)

상위: [Technical Architecture](technical_architecture.md) · 화면 계약: [Frontend Architecture](frontend_architecture.md) · 요구사항: [PRD](product_requirement_document.md).

기존 Next.js Route Handler·SQLite·Drizzle·Zod·Ollama 구조를 확장한다. 이 문서는 구현할 서버 계약이며, 아래 테이블·API·모듈이 이미 구현되었다는 의미가 아니다. 첫 버전은 영속 SQLite를 사용하는 단일 Node 서버로 운영하며 별도 작업 큐·주기 실행·외부 캘린더 쓰기를 추가하지 않는다.

---

## 1. 서버의 책임과 모듈 경계

| 계층 | 모듈 | 책임 |
|---|---|---|
| 공용 계약 | `contracts/auth`, `calendar`, `profile`, `search`, `booking`, `operations` | 입력·화면 DTO·오류의 Zod 스키마. DB·Next.js·비밀값에 의존하지 않음 |
| 순수 계산 | 기존 `core` + `core/profile`, `core/analysis` | 구간 정규화, 근거 집계, 상속 조건, 슬롯·양쪽 점수·설명 사실 |
| 모델 어댑터 | `llm/classify`, `onboarding`, 기존 `interpret`, `respond` | 검증 가능한 분류·변경 제안·설명. DB 변경·예약 확정 권한 없음 |
| 외부 어댑터 | `server/providers/google-auth`, `google-calendar` | OAuth 교환·검증, 토큰 갱신, 목록·일정·free/busy 조회 |
| 저장소 | `server/db`, `server/repos` | 버전 마이그레이션, 조회, CAS 갱신, 트랜잭션·인덱스 |
| 인증 서비스 | `server/session`, `services/auth` | 세션·소유권·실제/데모 모드·OAuth 흐름 |
| 캘린더 서비스 | `services/calendar-sync`, `event-annotations` | 선택·조회 작업·완결 snapshot·보완·해제 |
| 프로필 서비스 | `services/profile`, `analysis`, `onboarding` | 초안·근거·대화·최종 확정 |
| 예약 서비스 | `services/search`, 기존 `schedule`, `booking` | 탐색 상태, 계산 입력 조립, 요청·수락의 최신 검증 |
| 공통 작업 | `services/operations` | 멱등성, 실행 소유권, 결과 확인·재시도 |
| 전달 계층 | `app/api/**/route.ts`, 서버 페이지용 read model | 인증 → 입력 검증 → 서비스 → 계약에 맞춘 응답 |

서버 페이지는 read model을 조회한다. 조회·렌더 중 초안·탐색·메시지를 생성하거나 Google/LLM에 갱신 요청을 보내지 않는다. Route Handler와 서버 페이지가 각각 규칙을 구현하지 않고 같은 서비스·투영을 사용한다.

## 2. 인증·권한·실행 모드

### 2.1 로그인과 Calendar 권한

- 실제 모드 로그인은 `openid email profile`을 사용한다. 검증된 Google `sub`를 계정 키로 삼고 이메일로 다른 사용자와 자동 병합하지 않는다. ID token의 서명·issuer·audience·만료와 nonce를 확인한다.
- 로그인 시작은 POST로 만들고 OAuth 시도 ID를 브라우저의 짧은 수명 쿠키에 결합한다. `state`와 nonce는 일회용이며 10분 뒤 만료한다. callback에서는 시도 목적·브라우저 결합·현재 사용자·복귀 경로를 검사한다.
- Calendar 연결은 로그인 이후 별도 동의로 시작한다. `calendar.calendarlist.readonly`, `calendar.events.readonly`, `calendar.events.freebusy`만 요청하며 로그인한 계정과 같은 `sub`인지 확인한다.
- callback에서 토큰 교환을 마친 뒤 짧은 트랜잭션으로 OAuth 시도를 소비하고 연결을 저장한다. 교환·검증 실패로 반쯤 연결된 상태를 만들지 않는다. 중복 callback은 새 계정·연결을 생성하지 않는다.
- offline access의 refresh token은 서버 암호화 저장소에 보관한다. 재동의 응답에 새 refresh token이 없으면 같은 계정의 기존 유효 토큰을 유지한다. `invalid_grant` 등 복구 불가 상태는 재연결 필요로 전환한다. 세부 교환은 [Google 웹 서버 OAuth 문서](https://developers.google.com/identity/protocols/oauth2/web-server)를 따른다.
- 앱 세션은 무작위 opaque token이며 DB에는 해시를 저장한다. 절대 만료는 7일, 로그인 성공 시 새 토큰 발급, 로그아웃 시 폐기한다. 쿠키는 HttpOnly·SameSite=Lax, HTTPS에서는 Secure를 사용한다. 개발용 loopback HTTP 예외를 외부 배포에 적용하지 않는다.

### 2.2 권한 경계

- 사용자 ID는 세션에서 구한다. 변경 요청은 Origin/CSRF 검증을 거치며, OAuth callback은 위 state 검증을 사용한다. 복귀 URL은 허용한 앱 내부 경로와 해당 리소스 소유권만 인정한다.
- 초안·연결·수집 일정·근거·프로필 상세·작업 결과는 소유자 전용이다. 탐색은 client만, 수락·거절은 해당 host만, 철회는 해당 client만 변경할 수 있다. 타인 비공개 ID 조회에는 존재 여부를 드러내지 않는 404를 사용한다.
- 예약 서비스는 검증된 예약 관계 안에서 양쪽 캘린더를 내부 갱신할 수 있다. 이 권한으로 상대의 일정 상세·연결 토큰·분석 API를 호출할 수는 없다. 상대에게는 예약 준비 여부·후보·일반화된 실패 사유만 전달한다.
- 실제/데모 모드는 서버 설정과 DB 경로를 분리한다. 기존 `uid` 사용자 전환과 시드 폴백은 데모에서만 동작한다. 실제 모드의 `/api/session` 사용자 전환 요청은 허용하지 않는다.

## 3. 저장 모델·인덱스

### 3.1 공통 규칙

- 실제 시각은 UTC epoch millisecond 정수, 주간 규칙은 KST 요일 `0–6`·분 `0–1440`, 구간은 `[start, end)`로 통일한다. 종일 일정에는 원본 날짜와 시간대도 보존한다.
- 모든 변경 가능한 리소스에 정수 revision을 둔다. SQL의 `WHERE id = ? AND revision = ?`와 변경 행 수로 CAS를 검사한다. 클라이언트가 보낸 version을 권한의 근거로 사용하지 않는다.
- 작은 원자적 값인 프로필·조건·DTO snapshot은 JSON으로 저장하고 Zod 및 `CHECK(json_valid(...))`로 검사한다. 일정·작업·메시지처럼 독립 조회·삭제하는 데이터는 행으로 분리한다.
- DB 연결마다 `foreign_keys=ON`, WAL, `busy_timeout=2000`을 설정한다. FK는 실제 DDL에도 선언한다. SQLite의 FK 적용은 연결별 설정이 필요하다([공식 문서](https://www.sqlite.org/foreignkeys.html)).

### 3.2 테이블

| 테이블 | 주요 값·제약 |
|---|---|
| `users` | 기존 ID·이름, current_profile_version, setup_state, schedule_revision, host_settings_revision, annotation_revision, calendar_use_state·revision |
| `auth_identities` | user_id, provider, subject. `UNIQUE(provider, subject)` |
| `sessions` | token_hash 유일, user_id, expires_at, revoked_at |
| `oauth_attempts` | state_hash 유일, nonce 검증값, 브라우저 결합 해시, 목적, nullable user_id, return_path, expires_at, consumed_at |
| `calendar_connections` | user_id 유일, 계정 subject, status, 암호화 refresh token·key_version, granted_scopes, selection_revision, generation, analysis/schedule 활성 snapshot 포인터 |
| `calendar_sources` | connection_id·provider_calendar_id 유일, 이름·시간대·접근 수준·selected |
| `calendar_sync_runs` | connection_id, operation_id, selection_revision, base_generation, scope, 범위, started_at, lease_until, fence, status·오류 |
| `calendar_snapshots` | connection_id, sync_run_id 유일, generation, scope·범위, selection_revision, started_at, completed_at |
| `imported_events` | snapshot_id·calendar_id·provider_event_id 유일, 회차 식별자, 필요한 원본 필드, 정규화 구간·바쁨·장소·분류 지문 |
| `imported_busy_intervals` | snapshot_id, calendar_id, start_at, end_at. 상세 없는 free/busy 전용 |
| `event_annotations` | connection_id·calendar_id·provider_event_id 유일, revision, 필드별 원본 지문·사용자 보완·확인 상태 |
| `event_classifications` | 사용자/출처 키, 내용 지문, model_version, schema_version, 분류 제안. 동일 키·지문·버전 유일 |
| `analysis_runs` | user_id, 원본 snapshot·annotation revision, 기간, 완료/부분/실패, coverage, 계산 요약 |
| `analysis_evidence` | analysis_id, 참조 원본 행·집계 규칙·관측 횟수·기간. 소유자만 조회 |
| `profile_drafts` | user_id, status, revision, base_profile_version, 값 JSON, 주제 확인 JSON, analysis_id, updated_at. 사용자당 active 초안 하나 |
| `draft_messages` | draft_id, operation_id, role, content, 제안/근거 참조, created_at. 작업당 같은 역할 메시지 중복 방지 |
| `profile_versions` | user_id·version 유일, 값 JSON, origin, confirmed_at. 불변 버전 |
| `booking_searches` | client_id, host_id, revision, 상속 버전·선호 JSON, override JSON, initial_reply_state, 마지막 결과·자료 기준 |
| `search_messages` | search_id, operation_id, role, content, 후보/설명 snapshot, created_at. 작업당 같은 역할 메시지 중복 방지 |
| `requests` | 기존 값 + revision, nullable search_id, 요청 시 길이·양식명·장소 의미 snapshot |
| `events` | 기존 앱 일정. `source=booking`에 `(request_id, user_id)` 부분 UNIQUE, request FK |
| `mutation_operations` | owner_id·kind·key 유일, payload_hash, state, phase, reserved_resource_id, attempt, fence, lease_until, 완료 결과 참조·오류 |
| `service_leases` | resource_key 유일, owner_operation_id, fence, lease_until. 연결별 조회·토큰 갱신 조정 |
| `schema_migrations` | version 유일, checksum, applied_at |

활성 초안 유일 제약은 `status=active` 부분 인덱스로 둔다. 이벤트에는 `(snapshot_id, start_at, end_at)`, 앱 일정에는 `(user_id, start_at, end_at)`, 요청에는 `(client_id, status, start_at)`와 `(host_id, status, start_at)`, 메시지에는 `(parent_id, created_at, id)`에 해당하는 인덱스를 둔다. 연결·원본 제거 FK cascade와 앱 예약 보존 FK를 분리한다.

`places`, `meeting_types`는 기존 구조에 revision과 사용 가능 상태를 추가한다. 참조 중인 장소·양식 삭제는 비활성화로 처리하고 요청의 원래 의미를 잃지 않는다. 수락된 일정의 표시·장소는 현재 이름 변경에 종속시키지 않는다.

### 3.3 snapshot을 사용하는 이유

`imported_events`는 snapshot 안에서 불변이다. 회차의 안정적인 출처 키는 `연결 + 캘린더 + provider event ID`이며, 사용자 보완은 snapshot ID가 아닌 이 키와 관련 필드 지문에 연결한다. `recurringEventId`, `originalStartTime`, `iCalUID`를 보존해 반복 이동·복수 캘린더 사본을 판정한다.

연결에는 과거 분석용 포인터와 예약 계산용 포인터를 따로 둔다. 일반 전체 조회는 둘을 함께 바꾸고, 예약 직전 미래 조회는 예약 포인터만 바꾼다. 예약 계산은 **현재 예약 snapshot 하나**에서만 외부 일정을 읽는다. 이전 분석 snapshot의 미래 행을 합쳐 삭제·이동한 일정이 다시 차단되게 만들지 않는다.

활성 포인터·유효 분석에서 참조하지 않는 snapshot은 완료 작업의 정리 단계 또는 다음 명시적 변경 작업에서 제거한다. GET이 정리 작업을 수행하지 않는다. 원본 제거 때 작업 결과·메시지에 남은 원본 인용도 함께 정리하며, 작업 저장소에는 원본 API 본문을 복사하지 않는다.

## 4. 공통 API 계약과 멱등성

### 4.1 응답

```ts
type ApiResult<T> =
  | { ok: true; data: T; meta: { operationId?: string; revision?: number } }
  | { ok: false; error: {
      code: ErrorCode; message: string; retryable: boolean;
      fieldErrors?: Record<string, string[]>;
      currentRevision?: number;
      details?: SafeErrorDetails;
    }; meta: { operationId?: string; outcome: "not_applied" | "pending" | "unknown" } };
```

조회는 200, 생성은 201, 변경 성공은 200으로 통일한다. 진행 중인 동일 작업은 202와 `operation_pending`, operationId·권장 재조회 간격을 반환한다. 성공한 도메인 작업에 설명 fallback이 사용된 경우 `ok:true`와 data의 `explanationSource=template`로 표현한다. 네트워크 단절·응답 파싱 실패는 클라이언트의 `unknown`이며 서버의 실패 확정과 다르다.

보호된 응답은 공유 캐시 대상이 아니며 `Cache-Control: private, no-store`를 사용한다. 공용 read model과 API는 같은 DTO를 만든다. 외부 오류의 원문·토큰·타인 일정은 `details`에 넣지 않는다.

### 4.2 변경 작업의 수명

1. 변경 command는 `Idempotency-Key`를 필수로 받는다. 인증·기본 입력 검증 후 `사용자 + 작업 종류 + 키`로 조회하고, 정규화한 리소스 ID·본문·expectedRevision의 지문을 비교한다.
2. 처음이면 실행 소유권·lease·fence를 저장한다. 같은 키와 다른 입력은 409다. 같은 키로 완료된 요청은 기존 결과를 반환하며 도메인 변경을 반복하지 않는다.
3. 외부 I/O는 트랜잭션 밖에서 await한다. 살아 있는 lease를 가진 동일 작업에 대한 중복 호출은 202를 반환한다. 응답 뒤 실행이 보장되지 않는 작업을 새로 시작하지 않는다.
4. 최종 트랜잭션에서 fence·revision을 다시 확인한다. 도메인 변경과 `succeeded` 결과 참조를 함께 commit한다. 프로세스가 응답 전에 종료되어도 재조회로 결과를 복구한다.
5. 실패는 `failed_retryable` 또는 `failed_final`로 기록한다. 재시도 가능 실패·만료된 실행은 같은 입력·같은 키의 명시적 재전송으로 새 attempt와 fence를 얻을 수 있다. 이전 실행은 새 fence 이후 commit할 수 없다.
6. 입력 오류·revision 충돌·영향 변경 같은 확정된 거절은 같은 키로 반복해도 같은 실패다. 사용자가 최신 상태를 확인하고 다시 시도하는 동작은 새 키를 사용한다. 성공 키를 다시 사용해 새 탐색·새 예약을 만들 수 없다.

상태 조회는 `running / succeeded / failed_retryable / failed_final / interrupted`를 반환한다. `interrupted`는 running 행의 lease가 지난 상태를 읽기 시 계산한 값이며 GET으로 작업을 재개하지 않는다. 해당 작업이 없으면 `not_found`를 반환한다. 이 경우에도 원래 입력을 보존하고 있다면 같은 키로 전송해 중복 방지를 유지한다.

결과에는 리소스 ID·확정 version·도메인 결과를 저장한다. 재조회 시 최신 리소스와 완료 당시 결과를 구분한다. 일정 원본이 삭제되어도 프로필 확정·예약 성공 여부는 남고, 제거된 근거 상세는 다시 노출하지 않는다. 첫 버전에서는 키 기록을 자동 만료해 성공했던 작업이 다시 실행되게 하지 않는다.

## 5. Endpoint와 입력

표의 모든 변경 API는 §4의 작업 키를 사용한다. OAuth 시작은 일회용 시도 생성과 중복 방지를 적용하고 callback은 state로 검증한다. 별도 표시가 없는 리소스 변경은 `expectedRevision`을 받는다.

### 5.1 세션·캘린더·보완

| 메서드·경로 | 입력과 결과 |
|---|---|
| `GET /api/me` | 사용자·실행 모드·설정/초안·예약 준비 상태 |
| `POST /api/auth/google/start` | `purpose=login\|calendar`, 안전한 returnPath → authorizationUrl |
| `GET /api/auth/google/callback` | code·state 검증 → 앱 내부 redirect. 일반 GET의 읽기 전용 원칙에서 OAuth 프로토콜 예외 |
| `POST /api/auth/logout` | 세션 폐기, 동일 작업 재호출도 로그아웃 상태 유지 |
| `GET /api/calendar-connection` | 연결·선택 목록·scope별 자료 시각·실패·남은 자료 이용 결정 |
| `POST /api/calendar-connection/catalog-refresh` | 공급자 캘린더 목록 명시적 갱신. 일정 수집 성공과 구분 |
| `PUT /api/calendar-connection/selection` | `calendarIds, expectedSelectionRevision` → 새 revision·조회 필요 상태 |
| `POST /api/calendar-connection/sync` | `expectedSelectionRevision`, 일반 전체 조회 → snapshot·범위·generation |
| `DELETE /api/calendar-connection` | `expectedSelectionRevision` → 원본 제거·decision_required |
| `POST /api/calendar-use-decision` | `choice=continue_without_calendar`, 예상 이용 상태 revision → 남은 앱 자료 이용 확정 |
| `GET /api/imported-events/[id]` | 본인 현재 원본·보완·출처·유효성. 제거된 자료는 404 |
| `PUT /api/imported-events/[id]/annotation` | `expectedRevision, sourceFingerprint, patch` → 확인값·annotation/schedule revision |
| `GET /api/analysis-evidence/[id]` | 본인 근거 기간·실제 집계·출처. 오래된 근거는 상태를 함께 반환 |

새 연결의 최초 목록 조회도 callback의 제한 시간 안에서 await하거나 연결 완료 후 별도 catalog-refresh로 실행한다. 목록 실패를 빈 캘린더 목록의 성공으로 처리하지 않는다. 선택 저장과 실제 조회는 별도 작업이므로 UI는 선택 저장됨·일정 조회 완료를 구분할 수 있다.

### 5.2 초안·프로필

| 메서드·경로 | 입력과 결과 |
|---|---|
| `GET /api/profile` | 현재 확정 프로필·버전·편집 초안 유무 |
| `GET /api/profile-drafts/current` | active 초안 또는 null. 자동 생성 없음 |
| `POST /api/profile-drafts` | `purpose=onboarding\|edit` → 현재 active 초안 재사용 또는 새 초안 |
| `GET /api/profile-drafts/[id]` | 값·revision·baseProfileVersion·주제 확인·메시지·제안 |
| `PATCH /api/profile-drafts/[id]` | `expectedRevision, patch, topicConfirmations` → 정규화한 초안 |
| `POST /api/profile-drafts/[id]/turns` | `expectedRevision, text` → 같은 revision에 근거한 초안·대화 |
| `POST /api/profile-drafts/[id]/analysis` | `expectedRevision` → 제안·근거·완료 범위. 확정값 변경 없음 |
| `POST /api/profile-drafts/[id]/confirm` | `expectedRevision, baseProfileVersion` → 불변 프로필 버전·완료 상태 |

직접 입력 patch는 명시한 필드만 대체한다. 지원하지 않는 필드를 조용히 무시하지 않는다. 제안을 선택할 때는 proposalId·자료 기준도 전송해 삭제된 근거를 현재 사실로 확정하는 것을 막는다. S12는 GET으로 검증 결과를 볼 수 있지만 확정은 반드시 confirm command다.

### 5.3 탐색·예약·작업 조회

| 메서드·경로 | 입력과 결과 |
|---|---|
| `GET /api/hosts` | 공개 호스트 요약·예약 준비 여부 |
| `GET /api/hosts/[id]/booking-entry` | 호스트 정보·본인의 최근 탐색·신규/이어가기 진입 상태 |
| `POST /api/booking-searches` | `hostId, meetingTypeId?` → 독립 탐색·상속 snapshot·첫 응답 |
| `GET /api/booking-searches/[id]` | 저장 탐색·메시지·후보 상태. 계산 기준이 변했으면 stale |
| `POST /api/booking-searches/[id]/refresh` | `expectedRevision` → 필요한 외부 조회·최신 계산. 동일 첫 응답 재삽입 없음 |
| `POST /api/booking-searches/[id]/turns` | `expectedRevision, text` → 이번 탐색 조건·응답·후보 |
| `PATCH /api/booking-searches/[id]/conditions` | `expectedRevision, commands[]` → 직접 조건 변경·재계산 |
| `POST /api/requests` | `searchId, expectedSearchRevision, slot, message` → pending 요청 |
| `GET /api/requests?role=sent\|inbox` | 당사자 목록·파생 만료·알려진 확정 일정 충돌 |
| `GET /api/requests/[id]/accept-preview` | host 전용 현재 자동 거절 대상·impactToken. 가능 여부 확정 아님 |
| `POST /api/requests/[id]/accept` | `expectedRevision, impactToken` → accepted·자동 거절 ID·앱 일정 ID |
| `POST /api/requests/[id]/decline` · `/withdraw` | `expectedRevision` → 권한에 맞는 상태 변경 |
| `GET /api/operations/[id]` | 소유한 작업 상태·완료 결과 참조 |
| `GET /api/operations?kind=…&key=…` | 응답을 받지 못해 operationId가 없는 경우의 조회 |

`slot`에는 startAt·endAt·placeId·meetingTypeId를 모두 포함한다. 서버가 길이를 바꿔 endAt을 새로 만들어 수락시키지 않는다. 기존 수동 일정·호스트 설정 API는 유지하되 세션·작업 키·revision·공용 오류를 적용한다. 실제 모드의 기존 availability 직접 저장은 확정 절차를 우회하지 않도록 제거하고 초안 API로 옮긴다. 이전 conversation API 호출부는 search API로 함께 전환하며 서버에 두 개의 쓰기 경로를 남기지 않는다.

## 6. 캘린더 조회·정규화·이용 상태

### 6.1 완결된 조회만 활성화

1. 연결 상태·선택 집합·selectionRevision·baseGeneration·범위를 고정하고 연결별 조회 lease를 획득한다. 토큰 갱신도 별도 연결별 lease와 fence로 조정한다.
2. 일반 조회는 KST 오늘 00:00 기준 과거 56일~미래 60일, 예약 직전 조회는 미래 60일이다. 양끝에 180분을 추가 조회하되 후보 범위·분석 기간에는 포함하지 않는다.
3. 트랜잭션 밖에서 선택한 모든 캘린더의 모든 페이지를 읽는다. 반복 회차는 `singleEvents=true`, 동적 범위 조회에 syncToken은 사용하지 않는다. [Events.list 계약](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)에 맞춰 범위·페이징·취소를 처리한다.
4. detail 권한이 없는 캘린더는 free/busy로 읽는다. 캘린더 단위 오류·페이지 제한·시간 초과를 하나라도 만나면 미완결 실패다. 전체가 빈 목록으로 성공한 경우만 빈 snapshot을 활성화할 수 있다.
5. 성공 시 짧은 트랜잭션에서 연결·selectionRevision·baseGeneration·lease fence를 다시 검사한다. 모든 원본 행·새 snapshot·활성 포인터·generation을 함께 저장한다. 중간 응답은 활성 자료에 넣지 않는다.
6. 실패하면 기존 snapshot을 보존하고 이번 실패만 기록한다. 미래 조회 성공 시 과거 분석의 성공 시각을 갱신하지 않는다. 이전 snapshot이 있다는 이유로 예약 직전 실패를 무시하지 않는다.

연결별 실행이 이미 있으면 제한 시간 안에서 기다리거나 유효한 실행에 합류한다. 예약 작업의 조회 영수증은 해당 **attempt 시작 이후 시작된** 조회이고, 현재 선택 revision과 필요한 범위를 만족해야 한다. 이전 attempt의 영수증을 재시도에 재사용하지 않는다. 조정 중 제한 시간에 닿으면 `calendar_busy`를 반환한다.

### 6.2 원본 해석과 보완

- 취소·본인 참석 거절·transparent 일정은 차단에서 제외한다. needsAction·tentative는 차단한다. focus/OOO는 바쁨을 반영하되 업무 미팅 횟수로 세지 않는다.
- 종일 busy는 원본 시간대의 날짜 경계를 실제 시각으로 변환한다. 이동 기준점·시각 선호 집계에는 쓰지 않는다. workingLocation만으로 바쁨·실제 위치·근무시간을 확정하지 않는다.
- 상세 없는 busy와 미확인 시각 일정은 기존 `none` 이동 규칙을 적용한다. 온라인 확인 일정은 이동 기준점에서 제외한다. 회의 링크와 물리 장소가 함께 있으면 자동 온라인 확정 대신 사용자 보완 대상으로 둔다.
- 같은 사용자 캘린더 사이의 사본은 iCalUID·회차 원래 시각 등 공급자 근거가 맞을 때만 묶는다. 충돌하는 사본은 살아 있는 busy의 합집합·미확인 장소로 처리하고 빈도 집계에서 제외한다.
- 보완 저장은 원본 식별·관련 필드 지문을 재확인한다. 제목 변경은 위치 보완을 무조건 지우지 않으며, 위치/회의 방식 원본이 바뀌면 해당 보완을 재확인 상태로 둔다. 분류·위치 보완의 revision을 분석·일정 계산 기준에 포함한다.

### 6.3 선택 변경·연결 해제

| 상태 | 의미·예약 직전 동작 |
|---|---|
| `manual` | 사용자가 연동을 건너뛰거나 남은 자료 이용을 확인함. 앱 자료로 계산 |
| `connected` | 선택한 모든 캘린더의 유효 자료 있음. 전송·수락에서는 다시 조회 |
| `needs_refresh` | 선택 변경 또는 자료 범위 부족. 성공한 전체 선택 조회 필요 |
| `reconnect_required` | 공급자 권한/토큰 문제. 재연결 전 전송·수락 차단 |
| `decision_required` | 해제·모든 선택 제거 이후 남은 자료 이용 여부 미확정. 전송·수락 차단 |

이 상태와 신규 사용자 프로필 확정 요건은 별도다. `manual`이어도 허용 규칙 미확정이면 예약을 열지 않는다. 외부 장애를 사용자의 건너뛰기로 바꾸지 않는다.

선택 제거는 즉시 해당 출처를 읽기 모델에서 제외하고 원본·분류 캐시·분석 근거를 정리한다. 남은 선택은 새 selectionRevision으로 전체 조회해야 한다. 선택이 모두 없어지면 decision_required다. 연결 해제는 연결 행의 generation·revision을 올리고 token·수집 자료를 제거한 tombstone 상태를 남겨 진행 중 작업을 무효화한다. 같은 계정을 다시 연결해도 이전 fence는 살아나지 않는다.

AI가 원본에서 만든 인용·제안 메시지는 제거 또는 '근거 제거됨' 템플릿으로 바꾼다. 직접 작성한 발화·확정 프로필·앱 일정·예약 상태는 유지한다. 기존 확정 일정을 Google에 쓰거나 삭제하지 않는다.

## 7. 분석·초안·프로필 확정

### 7.1 프로필 값

```ts
type Window = { weekday: number; startMin: number; endMin: number };
type Preference<T> = { value: T; strength: "strong" | "weak" } | null;
type ProfileValues = {
  work: { mode: "fixed" | "none"; windows: Window[] };
  meetingWindows: Window[];
  preferences: {
    weekdays: Preference<number[]>;
    startTime: Preference<{ startMin: number; endMin: number }>;
    meetingMode: Preference<"online" | "offline">;
    slack: { strength: "strong" | "weak" } | null;
  };
};
```

초안은 각 주제의 `unanswered / confirmed`를 별도로 가진다. 빈 배열·null만 보고 아직 답하지 않은 상태와 '없음'을 구분하지 않는다. 겹치거나 맞닿은 구간은 요일별 합집합으로 정규화한다. 자정 넘는 직접 입력은 분리 확인이 필요하고 서버가 임의 요일로 옮기지 않는다.

시간·요일 선호를 함께 적용한 시작 시각 범위가 허용 구간과 전혀 맞지 않으면 필드 오류다. 모든 허용 구간을 비우는 경우에도 자동으로 선호를 지우지 않는다. '미팅을 받지 않음'을 저장하려면 충돌하는 요일·시간 선호를 사용자가 해제하도록 보여주며, 허용 구간 없음·선호 없음은 정상 저장한다. 선호 방식·여유는 특정 상대의 장소·양식을 전제로 검증하지 않는다. 근무 구간과 미팅 허용 구간은 서로를 자동 수정하지 않는다.

### 7.2 분석과 AI 턴

- 분석은 현재 분석 snapshot·보완 revision·분류 버전을 고정한다. 명시적 공급자 의미·사용자 확인값을 먼저 쓰고 나머지만 모델에 분류 요청한다. 모델에는 외부 event ID를 보내지 않고 묶음 안의 정수 번호(`i`)만 전달하며 서버가 번호를 실제 ID로 되돌린다. 응답은 `{business:[i],personal:[i],unknown:[i]}` 형식이다. 범위 밖 번호·서로 다른 분류에 중복된 번호·허용하지 않은 분류는 그 항목만 버리고 나머지는 유지한다. 외부 ID의 길이가 모델 출력량을 결정하면 안 된다.
- 기본 분류 묶음은 최대 40건, 한 analysis command는 최대 3묶음이다. 일부만 끝나면 classified/eligible 수와 `partial`을 반환한다. 재분석은 지문·모델·schema가 같은 캐시를 재사용하고 남은 자료를 처리한다. 부분 자료로 전체 빈도를 단정하지 않는다.
- 분류 요청의 출력 한도는 묶음 크기에서 계산한다(`128 + 16 × 건수`). 응답이 토큰 한도로 잘리면(`done_reason=length`) 전용 오류(`ModelTruncatedError`)로 구분하고, 같은 입력을 되풀이하지 않고 묶음을 반으로 나누어 다시 요청한다(깊이 3, 묶음당 모델 호출 최대 12회). 누락된 항목만 다시 요청할 수 있고, 서비스 장애(HTTP·시간 초과)는 즉시 중단한다. 끝내 분류하지 못한 일정은 `unknown`과 구분해 '분류하지 못한 일정 N건'으로 알린다.
- 제목만으로 업무·개인을 판단할 수 없거나 둘이 섞인 일정(식사·골프·네트워킹·모임처럼 상대만 있는 일정)은 반드시 `unknown`으로 둔다. 분류 규칙을 바꾸면 `event_classifications.schema_version`을 올려 이전 규칙의 캐시를 재사용하지 않는다(현재 2). 분류 결과는 요일 관찰과 건수 집계에만 쓰이며 허용 시간을 만들지 않는다.
- 빈도·시간 분포·예외는 코드가 계산한다. 근무 종료·미팅 한계·선호는 관측과 제안을 분리하고 사용자 확인을 기다린다. 재분석은 제안만 갱신하며 사용자 초안 값을 덮어쓰지 않는다.
- 대화는 시작 draftRevision과 자료 기준을 고정하고 외부 I/O 후 CAS한다. 사용자의 직접 편집 또는 출처 제거가 먼저 완료되면 오래된 결과를 적용하지 않는다. 원본 자료는 모델에게 명령이 아닌 데이터로 제공한다.
- 모델 해석은 구조 검증 실패 시 1회 재시도한다. 계속 실패하면 초안 값은 유지하고 실패 설명을 남긴다. 메시지 쌍·새 초안 revision·작업 결과는 한 트랜잭션으로 저장한다. CAS 충돌한 턴은 메시지까지 부분 저장하지 않고 클라이언트 입력을 유지시킨다.
- 설명 단계만 실패하면 검증된 사실의 템플릿을 사용한다. 제안 숫자·근거는 구조화 데이터로 표시하며 모델이 만든 숫자를 통계로 저장하지 않는다.
- 가져온 일정 목록 뷰는 종일 여부·날짜(끝 날짜 제외)·시간대와, 사용자 확인 분류(`classification`)와 별개인 AI 제안(`aiClassification`)을 함께 내려준다. AI 제안은 현재 분류 규칙 버전과 같은 내용 지문의 가장 최근 결과이며 확인 전까지 참고용이다. 내 캘린더 조회는 현재 일정 snapshot만 읽고 외부를 새로 호출하지 않으며 마지막 성공 조회 시각을 함께 내려준다.

### 7.3 확정 트랜잭션

소유권·모든 주제 확인·값·draftRevision·baseProfileVersion을 다시 검증한다. `BEGIN IMMEDIATE` 경계에서 새 profile version 생성 → current 포인터·setup_state·schedule_revision 변경 → 초안 확정 상태 → 작업 완료를 함께 commit한다. 다른 화면의 선행 확정은 `profile_version_conflict`다. 중간 편집값·AI 응답만으로 확정 버전을 만들지 않는다.

확정 프로필에는 사용자 규칙·선호만 저장하며 원본 일정·인용 문장은 복사하지 않는다. 새 확정값은 다음 계산의 허용 규칙에 적용하되 기존 탐색의 기본 선호 snapshot·pending/accepted 상태를 변경하지 않는다.

## 8. 탐색·계산·설명

### 8.1 상속과 command

새 탐색은 현재 client 프로필 버전과 기본 선호 snapshot을 저장한다. 각 선호 차원은 `inherit / override(value) / disabled`이며 conditions API는 `set`, `disable`, `restore_inherited`, `apply_latest_defaults`를 받는다. 마지막 command는 상속 기준만 바꾸고 override·disabled를 보존한다. 날짜·양식·정렬은 탐색 전용 조건으로 저장하며 전역 프로필에 쓰지 않는다.

장소 조건은 하나의 차원으로 관리한다. 상속한 meetingMode 또는 이번 탐색의 장소 ID 집합 중 유효한 하나만 사용한다. 같은 선호를 방식 점수와 장소 점수로 이중 가산하지 않는다. 기본값은 soft이며 이번 탐색의 명시적 must와 구분한다.

새 탐색 생성은 상속 snapshot을 먼저 확정해 둔다. 최초 준비가 외부 실패로 끝나도 같은 키로 새 탐색을 늘리지 않고 해당 searchId의 `unavailable` 상태를 반환한다. 재시도는 refresh로 진행한다. 양식이 여러 개이고 미정이면 질문, 하나거나 지정됐으면 해석 모델 호출 없이 계산 후 최대 3개 후보를 만든다. `initial_reply_state`와 메시지 작업 유일 제약으로 첫 질문·첫 후보의 중복을 막는다.

이 생성 작업은 재개 가능한 두 단계다. 첫 트랜잭션에서 탐색과 작업의 `reserved_resource_id, phase=search_created`를 함께 저장한다. 이후 종료되면 같은 키의 재시도는 이 탐색을 이어서 준비하며 새 행을 만들지 않는다. 후보/질문·초기 응답 상태·작업 완료는 마지막 트랜잭션으로 함께 저장한다. GET은 중간 상태를 not_ready로 읽을 뿐 실행을 이어가지 않는다. 조건 저장 후 별도 계산이 필요한 command도 변경 적용 checkpoint를 남겨 복구 시 patch를 두 번 적용하지 않는다.

### 8.2 계산 자료 기준

`schedule`은 최신 양쪽 허용 규칙, 앱 일정, 현재 외부 예약 snapshot, 유효 위치 보완, 호스트 장소·양식을 조립한다. 저장한 결과에는 다음 기준을 포함한다.

`searchRevision + client/host profileVersion + client/host scheduleRevision + hostSettingsRevision + 양쪽 selectionRevision/generation + annotationRevision + 계산시각/후보범위`

GET은 현재 기준과 달라졌거나 시간 경과로 후보가 만료되면 stale을 반환한다. 계산·설명 중 기준이 바뀌면 최대 1회 다시 계산하거나 stale로 반환하고 새 사실과 옛 설명을 섞지 않는다. 값 변경을 이미 저장했다면 계산 실패를 값 변경 실패처럼 반환하지 않고 저장된 조건과 unavailable/stale을 함께 준다.

### 8.3 순위와 설명 사실

- 먼저 양쪽의 허용·충돌·이동과 이번 탐색의 must를 적용한다. 시작은 30분 격자, 생성 최소 2시간 후, 전체 길이는 미래 60일 안에 들어가야 한다. 근무시간은 바쁨이나 이동 기준점이 아니다.
- 점수 단위는 `S=7,200,000`이다. 일반 일치는 `weight*S`, 여유는 `weight*clamp(slackMs,0,S)`, 강/약 weight는 10/3이다. 여유는 양쪽에 공통으로 확보되는 기존 기준을 사용한다. client와 host 점수를 합산하지 않는다.
- 명시 정렬 없음: client 점수↓ → host 점수↓ → 날짜·시각↑ → 장소·양식 ID. 명시 정렬 있음: client 점수↓ → 날짜↑ → 같은 날의 요청한 시각 순서 → host 점수↓ → ID.
- 점수는 정수의 정확한 같음으로 비교한다. 3·4위 버튼 판정에서 기본 시각·ID만으로 동점이 해소됐다고 보지 않는다. 명시적 시간 키와 양쪽 점수, 첫 후보·보여달라는 요청·후보 3개 이하 예외, 60분 다양화 규칙을 함께 적용한다.
- 코드가 조건 출처·선호 충족/불일치·호스트 동점 해소·다양화 사실을 만든다. 상대 원본 일정·위치는 설명 모델에 제공하지 않는다. 확정 프로필 없음 또는 선호 없음에서 '기본 선호에 맞췄다'고 생성하지 않는다.

## 9. 요청·수락의 원자성

### 9.1 외부 조회와 로컬 commit

1. 인증·역할·리소스·작업 키를 검사한다. 신규 프로필 미확정·재연결/이용 결정 필요 상태는 먼저 거절한다.
2. 연결된 양쪽 미래 캘린더를 병렬 조회한다. §6의 영수증을 모두 확보해야 한다. 한쪽 성공 후 다른 쪽 실패면 성공 자료는 보존하되 예약은 변경하지 않는다.
3. 외부 I/O를 끝낸 뒤 `BEGIN IMMEDIATE`로 쓰기 경계를 얻는다. 최신 프로필·일정·요청·장소·양식과 조회 영수증의 선택 revision·generation·범위를 다시 검사한다.
4. 순수 core로 선택 슬롯을 재검증하고 도메인 변경·작업 성공 결과를 함께 commit한다. snapshot이 바뀌면 최대 1회 다시 조회·검증하고, 계속 바뀌면 재시도 가능 충돌을 반환한다.

SQLite는 동시에 한 writer만 허용하므로 write 경계를 먼저 얻어 읽기 후 다른 로컬 쓰기가 끼는 것을 막는다. 이 안에서 네트워크·LLM·대기 재시도를 실행하지 않는다([SQLite transaction 문서](https://www.sqlite.org/lang_transaction.html)). 예약 생성은 2시간 여유를 적용하고 pending 수락은 lead=0으로 검사한다. 만료 판정은 기존 `startAt < now`를 유지한다.

### 9.2 생성과 수락의 불변 조건

- 생성 시 client의 호스트 무관 pending 겹침을 검사한다. 다른 사람의 pending은 공용 슬롯을 차단하지 않는다. 표시 당시 endAt·양식 길이·장소 의미와 현재 선택이 일치해야 한다.
- 요청에는 start/end·길이·양식명·장소 의미를 snapshot으로 저장한다. 현재 양식 길이 또는 장소의 온라인/오프라인·이동 의미가 바뀌거나 비활성화됐으면 `meeting_definition_changed`로 거절한다. 단순 표시명 변경은 원래 요청의 snapshot으로 표시한다. 길이가 바뀌었다고 과거 요청의 endAt을 몰래 바꾸지 않는다.
- 수락은 target이 pending인지, 두 사람의 현재 허용·일정·이동에서 **요청 당시 전체 구간**이 가능한지 검사한다. 이후 target accepted → 같은 host의 겹치는 pending declined → 양쪽 booking event 생성 → 작업 완료를 한 트랜잭션으로 처리한다.
- 이벤트 부분 UNIQUE와 요청 CAS를 함께 사용해 두 번 수락·다른 키 중복 수락에서도 앱 일정이 중복되지 않는다. 실패 시 요청 상태·자동 거절·두 일정 중 일부만 남지 않는다.
- 거절·철회는 외부 조회 없이 소유권·revision·pending 여부를 검사하고 원자적으로 변경한다. accepted 취소·변경은 첫 버전 API에 추가하지 않는다.

### 9.3 자동 거절 영향 확인

accept-preview는 target request revision·겹치는 pending ID/revision의 정렬된 집합 해시·사용자·발급/만료 시각을 서명한 impactToken을 반환한다. 유효기간은 5분이다. GET preview는 외부 캘린더를 갱신하지 않으며 수락 가능 보증이 아니다.

accept의 최종 트랜잭션에서 실제 자동 거절 집합을 다시 계산한다. preview와 다르면 아무 예약 상태도 바꾸지 않고 `accept_impact_changed`와 새 대상·토큰을 반환한다. 사용자의 재확인은 새 작업 키로 실행하고 외부 조회도 다시 한다. 대상 수만 같고 ID가 달라도 재확인한다.

Google 원본은 SQLite 트랜잭션에 참여하지 않으므로 조회 직후 Google에서 생기는 변경까지 잠글 수는 없다. 이후 갱신에서 발견한 accepted 충돌은 당사자 화면에 표시하며 자동 취소하지 않는다.

## 10. 오류·제한·관측

### 10.1 오류 매핑

| HTTP | code 예시 | 저장 결과·화면 동작 |
|---|---|---|
| 400/422 | `invalid_input`, `unsupported_condition`, `preference_conflict` | 적용 안 됨, 필드/지원 범위 안내 |
| 401/403 | `unauthenticated`, `forbidden`, `csrf_failed` | 재로그인 또는 권한 오류 |
| 404 | `not_found` | 없거나 소유하지 않은 리소스 |
| 409 | `revision_conflict`, `profile_version_conflict`, `source_changed` | 최신 상태 확인 후 새 작업 |
| 409 | `idempotency_key_reused` | 다른 입력에 같은 키 사용, 자동 재시도 금지 |
| 409 | `setup_required`, `calendar_decision_required`, `calendar_reconnect_required` | 해당 사용자 설정·연결 필요 |
| 409 | `slot_unavailable`, `overlapping_request`, `request_not_pending`, `request_expired`, `meeting_definition_changed` | 예약 미완료, 재선택/목록 갱신 |
| 409 | `accept_impact_changed` | 영향 재확인과 새 토큰 |
| 409/503 | `calendar_snapshot_changed`, `calendar_busy`, `database_busy` | 적용 안 됨, 제한된 재시도 |
| 502/503/504 | `calendar_fetch_failed`, `calendar_limit_exceeded`, `operation_timeout` | 이전 자료 유지, 작업 상태와 재시도 가능 여부 확인 |
| 500 | `internal_error` | commit 여부 불명확하면 outcome=unknown, 작업 결과 조회 |

LLM 출력 실패는 도메인 값 유지·직접 편집·설명 템플릿으로 처리한다. 해석 실패 플래그를 응답에 남겨 사용자가 말한 변경이 적용된 것으로 보이지 않게 한다. 예상하지 못한 DB/전송 오류에서 완료 여부를 확인하지 못했다면 `not_applied`라고 단정하지 않는다.

### 10.2 실행 예산

다음 값은 초기 서버 보호 설정이며 사용자 응답 시간 목표가 아니다. 실제 연동 검증 결과에 따라 설정값을 조정하되, 제한에 걸린 조회를 부분 성공으로 활성화하지 않는 규칙은 유지한다.

| 항목 | 초기 제한 |
|---|---|
| 외부 I/O를 포함한 command | 전체 90초, 실행 lease 120초, 종료/commit 전 fence 재검사 |
| Google HTTP 호출 | 본문 수신 포함 15초, 일시적 429/5xx·네트워크 실패 1회 재시도, 전체 조회 60초 안 |
| 일정 수집 | command당 합계 100페이지·50,000개 상세 일정 또는 busy 구간, 초과 시 실패 |
| LLM 요청 | 시도당 20초, 키 로테이션·해석 재시도도 command 전체 예산 공유 |
| 직접 슬롯 계산 | 기존 60일 계산 성능 기준 1초를 별도 측정. 외부 I/O와 분리 |
| DB writer 대기 | 2초, 잠금 실패 후 트랜잭션 안에서 대기 루프를 돌리지 않음 |

AbortController는 서버 외부 호출 제한에 사용하되 commit 성공을 되돌리는 수단으로 취급하지 않는다. 연결 종료 이후에도 이미 commit된 결과는 작업 조회로 확인한다. 제한 시간 종료·해제·lease 교체 이후의 늦은 응답은 fence 검사를 통과할 수 없다.

로그는 operationId·종류·단계·소요 시간·성공/실패 코드·페이지/처리 건수·revision 충돌·fallback 여부만 기록한다. 토큰·OAuth code·state·메시지 본문·원본 제목·위치·공급자 응답 원문을 남기지 않는다. 기존 catch의 임의 오류 객체 출력도 정제한 로그로 전환한다. 개인 원본을 다루는 DB·백업 파일도 동일하게 접근을 제한한다.

## 11. 기존 데이터 마이그레이션

1. 실제 적용 전 일관된 SQLite 백업과 복원 확인을 수행한다. WAL이 열린 DB 파일 하나만 복사한 것을 완전한 백업으로 간주하지 않는다. `better-sqlite3` backup API 등 SQLite가 제공하는 일관된 백업 경로를 사용한다.
2. 적용 버전·checksum을 기록하는 순서 있는 migration을 도입한다. 기존 시작 시 `CREATE TABLE IF NOT EXISTS`만으로 변경을 대신하지 않는다. 실제 DB의 reset/seed는 차단한다.
3. 기존 사용자별 enabled availability를 복수 구간으로 옮기고 version 1, origin=legacy로 저장한다. 근무 미확인·기본 선호 없음·온보딩 전환 미완료를 유지한다. 유효한 기존 규칙 보유자는 신규 미확정 사용자와 구분해 계속 예약할 수 있다.
4. conversation ID·client·host와 메시지를 그대로 search로 옮긴다. unique(client,host)는 제거하고 기존 필터는 전부 이번 탐색 override로 변환한다. 상속 선호는 빈 값이며 나중에 임의 추가하지 않는다.
5. 기존 UTC ISO 시각을 epoch millisecond로 검증 변환한다. 요청·이벤트·상태·관계를 유지하고 legacy 요청 snapshot은 저장된 start/end를 우선한다. 현재 설정으로 원래 장소 의미를 복구할 수 없는 경우 미확인으로 표시해 수락 전에 해결하게 한다.
6. FK·유일 제약 추가 전 고아 참조·중복 booking event를 점검한다. 문제가 있으면 행을 임의 삭제하지 않고 식별 가능한 진단과 함께 migration을 중단한다. 정상 변환 후 FK 검사·행 수/관계·대표 일정 비교를 수행한다.

테스트용 새 DB와 실제 migration 결과의 스키마를 대조한다. 실제 계정 DB에 데모 계정을 자동 이관하거나 이메일 추측으로 연결하지 않는다. 제품 코드 전환 때 기존 API 호출부도 함께 바꾸고 migration 완료 전에 새 서비스가 쓰기를 시작하지 않게 한다.

## 12. 검증과 완료 기준

| 영역 | 검증 사례 | 연결 기준 |
|---|---|---|
| 인증·소유권 | 다른 sub 연결, state 재사용/만료, 타인 원본·초안·작업 조회, 실제 모드 uid 우회 | AC-01 |
| 수집 원자성 | 반복 이동·삭제, 빈 성공, 중간 페이지/캘린더 실패, 선택 변경·해제 뒤 늦은 응답 | AC-01, AC-02, AC-12 |
| 범위·정규화 | 미래 조회가 과거 분석 시각을 바꾸지 않음, 옛 snapshot 일정 부활 방지, 종일 시간대·사본 충돌·free/busy | AC-02, AC-10 |
| 보완·분석 | 관련 필드 변경만 확인 해제, 실제 근거 ID·횟수, 부분 분석, 모델 실패·주입 데이터 | AC-03, AC-05, AC-10 |
| 초안·확정 | 점심 분할 구간, 선호 충돌, 없음 선택, AI 중 직접 편집, 두 화면 동시 확정, 같은 키 반복 | AC-04, AC-05 |
| 탐색 | 같은 상대 새 탐색·이어가기, 최초 응답 재시도, disable 지속, 최신 기본값 적용 시 override 보존 | AC-06, AC-07 |
| 순위·설명 | 정확한 정수 동점, 30초 여유 차이, 명시 시간 순서, 3·4위 동점·다양화·0개/선호 불일치 | AC-08, AC-09 |
| 예약 경합 | 양쪽 갱신 중 한쪽 실패, 조회 뒤 로컬 일정 변경, 다른 키 동시 수락, impact 대상 교체, 양식 길이 변경 | AC-11, AC-12 |
| 작업 복구 | commit 후 응답 유실, lease 만료 뒤 재시도, 이전 fence의 늦은 commit 차단 | AC-05, AC-11 |
| 보존·전환 | legacy 규칙/메시지/요청/일정 보존, 해제 후 원본 인용 제거·프로필/앱 예약 유지 | AC-12, FR-60–63 |

고정 clock·공급자 fixture·메모리 DB로 계산·서비스를 검증하고, writer 경합·migration·WAL 복구는 임시 파일 DB에서 검증한다. Google 실제 동의·목록·권한 차이·refresh token 갱신과 브라우저 중단 복구는 별도 통합 검증이며 목 테스트 통과로 대체하지 않는다. 기존 core·예약 회귀 테스트도 유지한다.

다음 문서는 **Implementation Plan**이다. 이 계약을 구현 순서·선행 의존성·작업별 검증 기준으로 나눈다. 현재 단계에서는 제품 코드·라이브러리·DB·실제 계정 연결을 변경하지 않는다.
