# AI 온보딩과 개인 미팅 프로필 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

작성일: 2026-10-04 · 상태: 확정 (2026-10-04) · 진행: T01–T16의 구현 파일이 대부분 존재하나 체크박스는 아직 갱신하지 않음. 2026-10-05 기준 실제 상태는 각 T 아래 '실행 기록' 참조

**Goal:** 캘린더 기록과 대화·직접 입력으로 개인 미팅 프로필을 확정하고, 새 예약의 첫 추천과 양쪽 선호 순위에 재사용한다.

**Architecture:** 기존 순수 core·LLM 어댑터·서버 서비스 구조를 확장한다. 사용자 초안과 확정 프로필, 외부 원본과 앱 일정, 탐색별 조건을 분리한다. 외부 조회는 DB 트랜잭션 밖에서 수행하고 revision·작업 키를 검사한 짧은 트랜잭션으로 변경을 확정한다.

**Tech Stack:** 현재 Next.js App Router·React·TypeScript·Tailwind·SQLite/better-sqlite3·Drizzle·Zod·Vitest·Ollama를 유지한다. Google 인증 라이브러리는 T06, DOM 테스트 도구는 T05에서 필요한 범위로 추가한다.

**Spec:** [PRD](product_requirement_document.md), [Technical Architecture](technical_architecture.md), [Frontend Architecture](frontend_architecture.md), [Backend Architecture](backend_architecture.md), [화면 목록](app_screen_list.md), [사용자 흐름](user_flow.md).

## Global Constraints

- 한국어 UI, KST 기준 표시·프로필 설정, 과거 56일 분석, 미래 60일·30분 시작 격자·최소 2시간 후 예약을 사용한다. pending 수락은 lead=0, 만료는 `startAt < now`다.
- 일반 조회는 과거 56일~미래 60일, 예약 직전에는 미래 범위를 조회하고 양끝에 180분을 더 읽는다. 추가 범위는 후보·분석 기간을 늘리지 않는다.
- 첫 버전은 Google 계정 하나·선택한 복수 캘린더의 읽기 전용 연동이다. 모든 선택 캘린더의 조회가 완료되어야 snapshot을 활성화한다.
- 근무시간은 배경 정보, 미팅 허용은 hard 조건, 기본 선호는 soft 조건이다. 신규 미확정 사용자에게 08–22시를 자동 부여하지 않는다.
- 기본 선호는 요일·시작 시간대 하나·온라인/오프라인·여유, 강/약 10/3이다. 날짜 예외·방식별 허용 규칙·최소 여유 hard 조건은 추가하지 않는다.
- 점수 단위는 `7,200,000`이며 client/host 점수를 별도로 비교한다. client 우선순위·명시 시간 정렬을 host 점수로 뒤집지 않는다.
- 초안 자동 저장은 500ms, 확정은 명시적 사용자 동작이다. 기본값 상속·override·disabled를 구분하며 재분석은 제안만 바꾼다.
- 전체 외부 command 90초·lease 120초, Google 호출 15초·전체 조회 60초, LLM 시도 20초, DB writer 대기 2초를 사용한다. 자세한 재시도·상한은 Backend §10을 따른다.
- 실제/데모 모드는 DB와 인증 경로를 분리한다. 실제 자료에 reset·시드 삽입·uid 폴백을 허용하지 않는다.
- 단일 Node·영속 SQLite 구성이다. 큐·cron·웹훅·외부 Calendar 쓰기·accepted 예약 취소 기능을 추가하지 않는다.
- `core`는 UI·서버·contracts를 import하지 않는다. 원본 일정·발화·토큰은 로그나 브라우저 저장소에 복제하지 않는다.

## Review Focus

다음 다섯 경계를 담당 작업의 테스트에 포함한다. 전체 AC를 대신하는 목록은 아니다.

1. **KST 자정 사이 갱신:** 한쪽 조회 중 날짜가 바뀌어 필요한 범위가 달라지면 불완전한 영수증으로 예약하지 않는다. T08·T13.
2. **해제 후 오래된 실행 복귀:** 같은 계정을 재연결해도 이전 실행의 fence로 원본·제안·토큰을 되살리지 못한다. T06·T08·T09.
3. **저장 응답과 새 입력의 엇갈림:** 이미 전송한 값까지만 저장됨으로 표시하고 더 새 입력을 잃지 않는다. T05·T10.
4. **같은 수의 자동 거절 대상 교체:** 개수는 같아도 ID/revision 집합이 달라졌으면 새 영향을 확인한다. T13·T14.
5. **요청 후 양식 길이 변경:** 원래 요청의 endAt을 바꾸거나 짧아진 양식만 검사해 수락하지 않는다. T13·T15.

---

## 1. 진행 방식과 현재 출발점

기존 프로젝트처럼 마일스톤별 완료 기준을 사용하되, 실제 구현은 아래 T01–T16의 검증 가능한 작업으로 나눈다. **이번 단계는 계획 문서 작성이며 제품 구현·설치·실제 DB 이전을 시작하지 않는다.** 다음 문서는 Repo Structure다.

현재 확인한 구현은 `src/server/context.ts`의 시드 사용자 폴백, `db/client.ts`의 시작 시 DDL 실행, `Person.events/rules`, 분 단위 `Slot.slackMin`, 호스트별 단일 conversation, 동기식 예약 트랜잭션이다. `src/server/session.ts`, `src/contracts/`, 신규 화면·서비스·테스트는 아직 없다. 기존 `docs/implementation_plan.md`의 완료 표시는 이전 MVP 기록이며 이번 확장의 검증 결과가 아니다.

실행을 시작할 때 현재 사용자 변경을 보존할 작업 공간을 정하고 `npm test`, `npm run typecheck`, `npm run build`의 기준 결과를 기록한다. 현재 저장소 파일이 대부분 untracked이므로 `git add .`로 다른 작업까지 묶지 않는다. 구현 단계에서 새 파일·수정 파일을 작업 단위로 검토하고 명시적으로 stage한다.

각 T 작업의 공통 순서는 **실패 사례 작성 → 해당 테스트의 예상 실패 확인 → 구현 → 해당 테스트와 typecheck 통과 → 변경 검토·작업 단위 커밋**이다. 테스트 파일이 없어서 0개가 실행된 결과를 통과로 보지 않는다. 아래 명령은 모두 `mvp/`에서 실행하며 `npm exec vitest run --`으로 실행해 중복 boolean 옵션 없이 빈 테스트를 실패로 처리한다.

중간 커밋은 개발 검증용이다. T16 전까지 실제 사용자 DB를 전환하거나 외부 공개하지 않는다. Google 설정이 준비되지 않아도 fixture와 데모 모드로 독립 작업을 진행하며 실제 연동 완료로 보고하지 않는다.

## 2. 파일 책임과 공통 인터페이스

기존 파일은 필요한 경계만 바꾼다. 상세 최상위 디렉터리 설명은 다음 Repo Structure에서 정리하되, 작업 파일과 인터페이스는 이 계획에서 고정한다.

| 위치 | 책임·소유 작업 |
|---|---|
| `src/core/profile.ts`, `calendar.ts`, 기존 `types.ts`, `slots.ts`, `filter.ts`, `options.ts`, `explain.ts` | 값·시간·정규화·슬롯·상속/순위. T01·T07·T11 |
| `src/contracts/{common,auth,calendar,profile,search,booking,operations}.ts` | Backend §4–5 DTO·command·오류 스키마. T01에서 계약, 담당 기능 작업에서 검증 보강 |
| `src/server/runtime.ts`, `config.ts`, `session.ts` | 주입 가능한 clock·의존성, 실행 모드, 세션. T02·T06 |
| `src/server/db/migrate.ts`, `migrations/001-availability-onboarding.ts` | migration·스키마 변환·backfill. T02, 실전 이전 검증 T15 |
| `src/server/repos/{operations,profiles,calendars,analyses,searches}.ts` | 새 저장 단위. T03·T04·T08·T09·T12 |
| `src/server/services/{operations,profile,calendar-sync,event-annotations,analysis,onboarding,search}.ts` | 서버 command와 read model. T03–T12 |
| `src/server/providers/{google-auth,google-calendar}.ts`, `src/server/token-vault.ts` | 외부 연결과 토큰. T06–T08 |
| `src/components/{api.ts,hooks/,onboarding/,calendar/,booking/}` | 변경 결과·편집 상태·화면 기능. T05·T10·T14 |
| `src/app/(public)/`, `src/app/(app)/`, 기존 `src/app/api/` | 공개/보호 화면과 얇은 Route Handler. T05 이후 |
| `tests/core`, `tests/server`, `tests/llm`, 신규 `tests/contracts`, `tests/components`, `tests/fixtures` | 순수·서비스·모델·DTO·DOM·고정 공급자 사례 |

**이름·타입의 기준**

- `core/profile.ts`가 `ProfileValues`, `WeeklyWindow`, `ProfilePreferences`를 정의한다. `core/time.ts`는 `TimeRange={fromMs:number;toMs:number}`, `core/types.ts`는 `PreferenceOverrides`, `EffectiveConditions`를 T01에서 정의한다. `contracts/profile.ts`는 프로필 값과 Backend §7에 맞는 스키마, `ProfileDraftView`, `ProfileView`, 각 입력 타입을 제공한다.
- `contracts/common.ts`가 `ApiResult<T>`, `DomainError`, `OperationMeta={key:string}`를 정의한다. Zod 입력 스키마의 `z.infer`를 command 타입으로 사용해 별도 수기 타입과 어긋나지 않게 한다.
- 각 도메인 contracts 파일은 Backend §5 표의 이름에 대응하는 입력·view 타입을 소유한다. 본문에는 userId를 받지 않고 서비스의 actorId로 전달한다. route의 draftId/searchId/requestId는 검증 후 서비스 Input에 포함한다. `expectedRevision` 예외인 selection/confirm/request 필드는 Backend 표 그대로 둔다.
- `server/runtime.ts`의 `ServiceContext`는 `db`, `clock.now():number`, 실행 설정, ID 생성기, 공급자/LLM 어댑터를 가진다. 작업별로 필요한 의존성만 사용하고 테스트에서는 clock·공급자를 주입한다. 인증 전 로그인은 브라우저 결합을 검사한 별도 auth 서비스 경로다.
- 변경 서비스 형태는 `command(ctx: ServiceContext, actorId: string, input: Input, op: OperationMeta): Promise<View>`다. 아래 서명의 `...`는 이 공통 `ctx, actorId`를 뜻한다. 예상 오류는 `DomainError`로 던지고 API에서 매핑한다. 순수 함수는 동기식이다. 테스트 예시의 `ctx`, 입력, fixture는 해당 테스트 파일에서 준비하며 운영 사용자 자료를 가져오지 않는다.

## 3. 마일스톤과 의존성

| 단계 | 작업 | 이 단계에서 확인할 결과 |
|---|---|---|
| M0. 계약·데이터 기반 | T01–T03 | 복수 구간·DTO·migration·작업 복구를 오프라인에서 검증 |
| M1. 수동 프로필 | T04–T05 | AI·Calendar 없이 직접 설정 → 자동 저장 → 확인 → 재개 |
| M2. 연결·일정 | T06–T08 | 실제/데모 인증 분리, 고정 공급자 자료의 완결 조회·삭제·경합 검증 |
| M3. AI 온보딩 | T09–T10 | 근거가 있는 제안·직접 편집·원본 보완·해제 복구 |
| M4. 예약 개인화 | T11–T12 | 기본값 상속·명시 조건·양쪽 점수·첫 추천 |
| M5. 예약 안전성·화면 | T13–T14 | 최신 외부 조회를 거친 요청·수락·결과 복구 |
| M6. 이전·통합 검증 | T15–T16 | 기존 자료 보존, 실제 연동과 브라우저 AC-01–12 검증 |

기본은 표 순서대로 진행한다. 독립 작업을 나눌 때만 T07은 T01 이후, T11은 T01·T07 이후 수행할 수 있다. T09는 T04·T08, T12는 T03·T04·T08·T11, T13은 T12가 필요하다. 파일을 공유하는 `types.ts`, DB schema, 공용 DTO 변경은 먼저 합의한 작업 결과를 반영한 뒤 이어서 진행한다.

## 4. 구현 작업

### T01. 프로필 값·공용 계약

**파일:** 생성 `src/core/profile.ts`, `src/contracts/common.ts`, `src/contracts/auth.ts`, `src/contracts/calendar.ts`, `src/contracts/profile.ts`, `src/contracts/search.ts`, `src/contracts/booking.ts`, `src/contracts/operations.ts`; 수정 `src/core/time.ts`, `src/core/types.ts`; 테스트 `tests/core/profile.test.ts`, `tests/contracts/inputs.test.ts`.

**인터페이스:** `normalizeWindows(windows: WeeklyWindow[]): WeeklyWindow[]`, `validateProfile(values: ProfileValues): {valid:boolean; fieldErrors:Record<string,string[]>}`. Backend §4–5·§7의 입력/view 스키마와 타입을 내보낸다. draft의 주제 확인 상태는 값과 분리한다.

- [ ] `merges_adjacent_windows_but_preserves_lunch` 테스트에서 화요일 10–11, 11–12, 14–18시를 입력해 아래 결과를 확인한다. 자정 넘는 구간·지원하지 않는 기본 선호·시간/요일 선호의 결합 충돌은 오류, 모든 항목 없음은 유효로 검사한다.

```ts
expect(normalizeWindows(windows)).toEqual([
  { weekday: 2, startMin: 600, endMin: 720 },
  { weekday: 2, startMin: 840, endMin: 1080 },
]);
```

- [ ] `npm exec vitest run -- tests/core/profile.test.ts tests/contracts/inputs.test.ts`로 예상 실패를 확인한다.
- [ ] 위 함수·Zod 스키마를 구현한다. 초안 입력과 확정 검증을 분리해 주제 미확인 상태는 저장 가능하지만 확정은 불가능하게 한다. DTO는 근거·revision·작업 상태와 본인/상대 투영을 구분한다.
- [ ] 같은 명령과 `npm run typecheck`를 통과시키고 T01 파일만 검토·커밋한다. **완료:** 공용 계약이 UI/DB 없이 로드되고 FR-07·30–38을 표현한다.

### T02. 버전 migration·실행 모드·저장 경계

**선행:** T01. **파일:** 생성 `src/server/db/migrate.ts`, `src/server/db/migrations/001-availability-onboarding.ts`, `src/server/config.ts`, `src/server/runtime.ts`, `tests/server/migrations.test.ts`, `tests/fixtures/legacy-db.ts`; 수정 `db/schema.ts`, `db/ddl.ts`, `db/client.ts`, `db/seed.ts`, 기존 repos의 저장 변환, `scripts/db-reset.ts`, `tests/server/helpers.ts`, `.env.example`.

**인터페이스:** `migrateDatabase(sqlite: Database.Database): void`, `readServerConfig(env: NodeJS.ProcessEnv): ServerConfig`, `ServiceContext`. 기존 `createDb()`는 migration을 거친 DB를 반환한다. legacy fixture는 구현 전 DDL·대표 행을 고정해 새 DDL로 가짜 legacy DB를 만들지 않는다.

- [ ] `migrates_legacy_without_inventing_preferences`에서 disabled 규칙·대화·요청·양쪽 이벤트를 포함한 파일 DB를 변환한다. original ID/관계·시각 동일, 선호 null, 필터는 override, 재실행 시 행 수 불변을 검사한다.

```ts
expect(after.requestIds).toEqual(before.requestIds);
expect(after.profile.preferences.weekdays).toBeNull();
expect(after.foreignKeyViolations).toEqual([]);
```

- [ ] `npm exec vitest run -- tests/server/migrations.test.ts`로 실패를 확인한다.
- [ ] Backend §3·11의 테이블·인덱스·FK·backfill·epoch 변환을 구현한다. 현재 repo 반환 계약을 필요한 기간 유지하는 얇은 변환을 두고 DB 이중 쓰기는 만들지 않는다. 기존 conversations repo도 새 search 저장소 표현에 연결해 이전 호출부를 T12까지 유지한다. 모드·DB 분리, 실제 reset 금지, WAL·FK·2초 대기를 적용한다.
- [ ] 해당 테스트·기존 `tests/server`·typecheck를 통과시키고 커밋한다. **완료:** 신규/legacy DB가 같은 스키마이며 고아 참조·중복 booking event는 자동 삭제 없이 migration을 중단한다.

### T03. 작업 키·CAS·결과 복구

**선행:** T02. **파일:** 생성 `src/server/repos/operations.ts`, `src/server/services/operations.ts`, `tests/server/operations.test.ts`; 수정 `src/server/api.ts`, `src/server/log.ts`; 생성 `src/app/api/operations/route.ts`, `src/app/api/operations/[id]/route.ts`.

**인터페이스:** `beginOperation(ctx, actorId, kind, input, op): OperationClaim`, `commitOperation(tx, claim, result): void`, `readOperation(ctx, actorId, lookup): OperationView`. `OperationClaim`은 ID·attempt·fence·lease·재생 결과/실행 여부, `OperationView`는 Backend §4.2의 상태·참조를 제공한다. tx는 T02의 SQLite/Drizzle transaction 경계다.

- [ ] `replays_commit_after_lost_response`와 `expired_fence_cannot_commit`에서 동일 키 재전송은 한 행, 다른 입력은 409, lease 지난 뒤 재획득한 실행만 commit 가능함을 검사한다.

```ts
expect(replayed.resourceId).toBe(first.resourceId);
expect(resourceRows).toHaveLength(1);
expect(staleCommit.error.code).toBe("operation_lease_lost");
```

- [ ] `npm exec vitest run -- tests/server/operations.test.ts`로 실패를 확인한다.
- [ ] 입력 지문·유일 키·running/완료/실패·읽기 시 interrupted·checkpoint를 구현한다. `operation_lease_lost`는 내부 오류이며 API에서는 안전한 작업 상태로 매핑한다. 완료 결과와 도메인 변경은 같은 transaction, GET은 재실행하지 않는다. 원문 없는 오류 로그를 적용한다.
- [ ] 두 DB 연결을 사용하는 잠금/만료 테스트와 typecheck를 통과시키고 커밋한다. **완료:** 네트워크 실패를 DB 실패로 단정하지 않고 소유자만 결과를 복구한다. T06에서 이 조회 API에 실제 세션 경계를 연결한다.

### T04. 수동 프로필 초안·확정 서비스

**선행:** T01–T03. **파일:** 생성 `src/server/repos/profiles.ts`, `src/server/services/profile.ts`, `tests/server/profile.test.ts`; 생성 `src/app/api/profile/route.ts`, `profile-drafts/route.ts`, `profile-drafts/current/route.ts`, `profile-drafts/[id]/route.ts`, `profile-drafts/[id]/confirm/route.ts`.

**인터페이스:** `createDraft(ctx, actorId, input: CreateDraftInput, op): Promise<ProfileDraftView>`, `patchDraft(ctx, actorId, input: PatchDraftInput, op): Promise<ProfileDraftView>`, `confirmProfile(ctx, actorId, input: ConfirmProfileInput, op): Promise<ProfileView>`. read model은 확정값과 초안을 별도 조회한다.

- [ ] `draft_does_not_change_active_profile`에서 편집 중 이전 확정 version 유지, 두 화면 동시 confirm 중 하나만 성공, 같은 키 confirm 반복은 같은 version임을 검사한다.

```ts
expect(profileBeforeConfirm.version).toBe(1);
expect(confirmReplay.version).toBe(confirmResult.version);
expect(otherConfirm.error.code).toBe("profile_version_conflict");
```

- [ ] `npm exec vitest run -- tests/server/profile.test.ts`로 실패를 확인한다.
- [ ] 사용자당 active 초안 하나·revision CAS·주제 확인·baseProfileVersion·원자적 확정을 구현한다. 신규 미확정·확정된 빈 허용 규칙·legacy 사용자를 구분해 readiness를 반환한다. Backend §5.2 API를 붙인다.
- [ ] 테스트·typecheck를 통과시키고 커밋한다. **완료:** Calendar/LLM 없이 FR-02·05–07·30–37의 저장과 복구가 된다.

### T05. 직접 설정 화면·자동 저장·작업 UI

**선행:** T04. **파일:** 생성 `src/components/hooks/useMutationOperation.ts`, `useEntryOperation.ts`, `src/components/onboarding/ProfileEditor.tsx`, `WeeklyWindowsEditor.tsx`, `PreferenceEditor.tsx`, `ProfileSummary.tsx`, `OnboardingWorkspace.tsx`, `draftReducer.ts`, `useDraftAutosave.ts`, `tests/components/profile-editor.test.tsx`; 수정 `src/components/api.ts`, `AvailabilityForm.tsx`, `Header.tsx`, `src/app/layout.tsx`, `vitest.config.ts`, `package.json`·lockfile.

**라우트:** 기존 보호 페이지를 `src/app/(app)/` 아래 같은 상대 경로로 옮기고 `(app)/layout.tsx`에 Header를 둔다. `(app)/onboarding/page.tsx`, `onboarding/review/page.tsx`를 생성하고 `(app)/settings/availability/page.tsx`를 확정 프로필 조회로 바꾼다. URL은 유지하며 API는 옮기지 않는다.

**인터페이스:** `draftReducer(state: DraftEditorState, action: DraftAction): DraftEditorState`, `useDraftAutosave(draftId: string, state: DraftEditorState)`가 저장 snapshot·dirty 입력·진행 작업을 분리한다. `useMutationOperation`은 T03의 상태 조회 계약을 사용한다.

- [ ] `saving_old_value_keeps_new_input_dirty`에서 fake timer 499ms에는 전송 없음, 500ms에 전송, 대기 중 새 입력 후 이전 응답 도착 시 새 입력이 남음을 검사한다. 테스트에 필요한 React Testing Library·jest-dom·jsdom, `tests/components/setup.ts`, `.test.tsx` 수집을 이 단계에서 설정한다. DOM 환경은 컴포넌트 테스트에만 적용한다.

```ts
expect(state.form.meetingWindows).toEqual(newerInput);
expect(state.saved.meetingWindows).toEqual(sentInput);
expect(state.dirtyFields).toContain("meetingWindows");
```

- [ ] `npm exec vitest run -- tests/components/profile-editor.test.tsx`로 실패를 확인한다.
- [ ] 500ms 순차 저장·dirty 병합·revision 충돌·명시적 확인·정확한 draft URL 재개를 구현한다. Workspace key는 사용자+ID이며 revision으로 remount하지 않는다. 작동 중 결과 조회만 제한 폴링하고 원본/폼은 sessionStorage에 넣지 않는다.
- [ ] DOM 테스트·typecheck를 통과시키고 데모에서 직접 설정→확인→새로고침을 확인 후 커밋한다. **완료:** M1을 AI 없이 시연하며 S2·S11·S12와 접근 가능한 입력·상태 안내가 작동한다.

### T06. 실제 로그인·Calendar 동의·토큰 보관

**선행:** T03·T05. **파일:** 생성 `src/server/session.ts`, `src/server/providers/google-auth.ts`, `src/server/token-vault.ts`, `src/server/services/auth.ts`, `tests/server/auth.test.ts`, `src/app/api/auth/google/start/route.ts`, `callback/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/me/route.ts`, `src/app/(public)/login/page.tsx`; 수정 `context.ts`, API 인증 경계, `api/session/route.ts`, `Header.tsx`, `(app)/layout.tsx`, `.env.example`, package·lockfile.

**인터페이스:** `requireActor(request): Promise<Actor>`, `startGoogleAuth(ctx, binding, input: AuthStartInput): Promise<AuthStartView>`, `completeGoogleAuth(ctx, binding, input: AuthCallbackInput): Promise<AuthCallbackResult>`. `binding`은 검증한 브라우저 시도/세션이며 본문 userId가 아니다. 공급자 검증은 google-auth-library 어댑터로 격리한다.

- [ ] `rejects_foreign_sub_and_replayed_state`에서 issuer/audience/nonce/state·10분 만료·다른 sub 연결·실제 uid 우회·타인 operation 조회를 검사한다. 갱신 응답에 refresh token 없음은 기존 값 유지, 해제 fence 이후 응답은 저장 거부다.

```ts
expect(replayedCallback.createdSession).toBe(false);
expect(foreignCalendarLink.error.code).toBe("account_mismatch");
expect(realModeActorFromUid).toBeNull();
```

- [ ] `npm exec vitest run -- tests/server/auth.test.ts`로 실패를 확인한다.
- [ ] 읽기 전용 추가 동의·stable sub·7일 세션·암호화 token·CSRF/Origin·안전한 복귀를 구현한다. `account_mismatch`는 auth 계약에 추가하는 입력 거절 코드다. T03–T05 API와 기존 수동 일정·호스트 설정·예약 API 모두 같은 권한 경계를 사용하게 한다.
- [ ] fixture 인증 테스트·typecheck를 통과시키고 커밋한다. **완료:** 실제/데모 경로가 분리된다. 실제 Google 설정은 T16의 외부 검증 준비로 기록하며 미준비를 테스트 성공으로 대체하지 않는다.

### T07. 외부 이벤트 정규화·차단과 이동 분리

**선행:** T01. **파일:** 생성 `src/core/calendar.ts`, `tests/core/calendar.test.ts`, `tests/fixtures/google-events.ts`; 수정 `src/core/types.ts`, `availability.ts`, `slots.ts`, `travel.ts`, `tests/core/helpers.ts`, `tests/core/slots.test.ts`, `tests/core/travel.test.ts`, `src/server/services/schedule.ts`의 기존 입력 어댑터.

**인터페이스:** `normalizeCalendarEvents(input: CalendarSourceInput[]): NormalizedCalendar`, `NormalizedCalendar={busyIntervals,travelAnchors,analysisEvents}`. source 입력 타입·출처 키는 `core/calendar.ts`에 정의하며 provider 어댑터가 공급자 JSON을 검사해 투영한다. `Person`은 정규화된 busy·anchor와 복수 windows를 받으며 `Slot`의 여유 기준을 정수 `slackMs`로 바꾼다.

- [ ] `all_day_blocks_without_travel_anchor`에서 뉴욕 종일 일정의 DST 날짜를 고정 fixture로 변환해 busy의 정확한 UTC 시작/끝과 anchor 없음, 온라인 링크+물리 장소는 미확인임을 검사한다. 취소·declined·tentative·free/busy·사본 충돌도 포함한다.

```ts
expect(normalized.busyIntervals).toEqual(expectedUtcIntervals);
expect(normalized.travelAnchors).toEqual([]);
expect(conflictingCopies.analysisEvents).toEqual([]);
```

- [ ] `npm exec vitest run -- tests/core/calendar.test.ts tests/core/slots.test.ts tests/core/travel.test.ts`로 실패를 확인한다.
- [ ] 시간대·회차·사본 정규화와 busy/anchor 분리를 구현한다. 기존 이동 0/30/60분·온라인 건너뛰기·공통 여유 120분 상한을 유지한다. 기존 필터 소비자는 정수 여유에서 필요한 표시값을 파생시키고 반올림으로 순위를 바꾸지 않는다.
- [ ] 위 회귀 테스트·typecheck를 통과시키고 커밋한다. **완료:** 종일/업무 위치가 이동 anchor를 만들지 않고 60일 전체 슬롯 경계를 유지한다.

### T08. 전체 캘린더 조회·snapshot·해제

**선행:** T02·T03·T06·T07. **파일:** 생성 `src/server/providers/google-calendar.ts`, `src/server/repos/calendars.ts`, `src/server/services/calendar-sync.ts`, `event-annotations.ts`, `tests/server/calendar-sync.test.ts`, `tests/server/event-annotations.test.ts`; 생성 Backend §5.1의 calendar-connection·calendar-use-decision·imported-events API 경로에 해당하는 `route.ts`.

**인터페이스:** `syncCalendars(ctx, actorId, input: SyncInput, op): Promise<SyncView>`, `refreshForBooking(ctx, userId: string, attemptStartedAt: number, range: TimeRange): Promise<CalendarReceipt>`, `disconnectCalendar(ctx, actorId, input: DisconnectInput, op): Promise<CalendarConnectionView>`. `CalendarReceipt`는 범위·조회 시작·선택 revision·generation·fence를 제공하는 calendar-sync 내부 타입이다. 보완은 `saveEventAnnotation(..., input: SaveAnnotationInput, op): Promise<EventAnnotationView>`다.

- [ ] `failed_page_preserves_active_snapshot`·`future_refresh_never_resurrects_old_event`·`disconnect_invalidates_inflight_sync`를 작성한다. KST 자정 통과 시 범위 검증 실패, 180분 padding, token 갱신 single flight, 부분 free/busy 오류도 고정 clock으로 검사한다.

```ts
expect(afterFailure.activeSnapshotId).toBe(before.activeSnapshotId);
expect(currentSchedule.eventIds).not.toContain(deletedEventId);
expect(afterDisconnect.importedRows).toHaveLength(0);
```

- [ ] `npm exec vitest run -- tests/server/calendar-sync.test.ts tests/server/event-annotations.test.ts`로 실패를 확인한다.
- [ ] 모든 선택·모든 페이지 성공 시 snapshot 교체, 분석/예약 포인터 분리, selectionRevision·fence·한도·실패 보존을 구현한다. 선택 제거/해제는 근거·캐시·원본 인용까지 제거하고 앱 예약·확정 프로필을 보존한다. 현재 없는 분석 테이블도 삭제 경로에 포함해 T09와 같은 규칙을 사용한다.
- [ ] 테스트·typecheck를 통과시키고 커밋한다. **완료:** 조회·보완·계속 사용 상태가 API에서 구분되며 GET은 외부 갱신하지 않는다.

### T09. 근거 분석·온보딩 AI 턴

**선행:** T04·T08. **파일:** 생성 `src/core/analysis.ts`, `src/llm/classify.ts`, `onboarding.ts`, `src/server/repos/analyses.ts`, `src/server/services/analysis.ts`, `onboarding.ts`, `tests/core/analysis.test.ts`, `tests/llm/onboarding.test.ts`, `tests/server/onboarding.test.ts`; 수정 `src/llm/ollama.ts`; 생성 profile-drafts `[id]/analysis`, `[id]/turns`, analysis-evidence `[id]`의 API `route.ts`.

**인터페이스:** `analyzeHistory(events: AnalysisEvent[], range: TimeRange): AnalysisSummary`는 코드로 집계한다. `AnalysisEvent`는 T07의 core/calendar, `AnalysisSummary`는 core/analysis가 소유한다. `analyzeDraft(..., input: AnalyzeDraftInput, op): Promise<ProfileDraftView>`, `sendOnboardingTurn(..., input: OnboardingTurnInput, op): Promise<ProfileDraftView>`는 contracts/profile 입력과 T04의 초안 CAS를 사용한다.

- [ ] `late_meeting_is_evidence_not_permission`과 `manual_edit_wins_over_delayed_ai`에서 늦은 1건은 허용시간 자동 확장 없음, 잘못된 event ID/지시문은 도구 실행 없음, 해제 후 오래된 제안 적용 없음, 부분 분류는 partial임을 검사한다.

```ts
expect(afterAnalysis.values).toEqual(beforeAnalysis.values);
expect(delayedTurn.error.code).toBe("revision_conflict");
expect(partial.analysis.coverage.classified).toBeLessThan(partial.analysis.coverage.eligible);
```

- [ ] `npm exec vitest run -- tests/core/analysis.test.ts tests/llm/onboarding.test.ts tests/server/onboarding.test.ts`로 실패를 확인한다.
- [ ] 명시 타입/사용자 확인 우선·지문 캐시·40건×최대 3묶음(모델에는 번호만 전달, 잘림 시 묶음 분할; 온보딩 해석은 구조 오류 1회 재시도)·템플릿 fallback을 구현한다. 키 교체와 재시도도 전체 90초 budget을 공유한다. 초안·메시지 쌍·작업 결과는 같은 revision에 commit하고 원본 변경 시 재확인을 요구한다.
- [ ] 위 테스트·기존 LLM 회귀·typecheck를 통과시키고 커밋한다. **완료:** 빈 기록·모델 장애에도 직접 설정 가능하며 횟수·기간은 실제 집계와 같다.

**실행 기록 (2026-10-05):**
- 합성 VC 캘린더(10–18시 근무, 과거 8주 110건)로 `scripts/eval-onboarding.ts`를 돌려 분류 커버리지 27%(30/110)를 발견했다. 원인은 다섯 가지다. ① 모델이 외부 이벤트 ID(`["source","[\"캘린더\",\"id\"]"]` 꼴, 이중 이스케이프)를 그대로 되돌려 써서 출력이 ID 길이에 비례했다(실측 토큰/건: 번호 18.2, 단일 이벤트형 48.5, 반복 인스턴스형 65.5). ② 출력 한도가 1800으로 고정이라 40건 배치가 1938·2618토큰을 요구해 잘렸다. ③ `OllamaClient.chat()`이 `done_reason`/`eval_count`를 버려 잘림이 일반 JSON 오류로 보였다. ④ temperature 0이라 같은 재시도가 같은 실패를 하고 지연만 2배가 됐다. ⑤ 검증이 배치 전부-또는-전무였다. 단일 이벤트형 기준 약 37건, 반복형 약 27건부터 배치가 잘리므로 실제 캘린더에서는 거의 항상 발생한다.
- 수정: 모델에는 번호만 보내고 서버가 ID를 복원하며(`src/llm/classify.ts`), 압축 응답(실측 약 5토큰/건)·항목별 검증·`done_reason=length` 전용 오류(`src/llm/ollama.ts`)·잘림 시 묶음 분할(깊이 3, 호출 최대 12)·서비스 장애 즉시 중단·출력 한도 `128+16×건수`를 적용했다. 애매한 일정은 반드시 `unknown`으로 두는 규칙을 넣고 캐시 `schema_version`을 1→2로 올렸다(`CLASSIFICATION_SCHEMA_VERSION`). 요약 문구는 'AI가 분류하지 못한 일정 N건'을 판단 불가(`unknown`)와 구분하고, 분류 로그(`analysis.classify`: 건수·호출·잘림·ms, 내용 없음)를 남긴다.
- 검증: `tests/llm/classify.test.ts`(8), `tests/llm/ollama.test.ts`(+2), `tests/server/analysis.test.ts`(3, 분석 서비스 테스트가 없었음)를 추가했다. 스키마 버전 되돌리기·분할 끄기 변이에서 각각 실패함을 확인했다. 실모델 스모크는 커버리지 27%→100%(110/110), 분석 26.8초→4.4초(호출 3회, 재시도·잘림 0), 확실한 일정 102/103 정답(업무 1건이 `unknown`, 안전한 방향 오류), 애매한 7건 모두 `unknown`이었다. 규칙에 쓰지 않은 제목 26개 추가 확인은 26/26이었다.
- 한계: 합성·확인 제목은 모두 에이전트가 만들었으므로 실제 사용자 제목의 `unknown` 과다 비율은 측정하지 못했다. 한 command 최대 120건(설계 한도)은 그대로다. T09 체크박스는 T09 전체 검증 전이라 유지한다.

### T10. 연결·근거·AI 온보딩 화면

**선행:** T05·T06·T08·T09. **파일:** 생성 `src/components/calendar/CalendarConnectionManager.tsx`, `EventDetailsPanel.tsx`, `EventAnnotationForm.tsx`, `src/components/onboarding/OnboardingChat.tsx`, `EvidencePanel.tsx`, `WeekSchedule.tsx`, `tests/components/calendar-onboarding.test.tsx`, `src/app/(app)/settings/calendars/page.tsx`; 수정 `OnboardingWorkspace.tsx`, `(app)/calendar/page.tsx`, `(app)/onboarding/page.tsx`, `(app)/onboarding/review/page.tsx`.

**인터페이스:** CalendarConnectionView·ProfileDraftView·EventAnnotationView를 props로 전달한다. AI 전송은 T05 저장 완료 후 T09 command를 호출하며 주간표·칩을 별도 정답 상태로 저장하지 않는다.

- [ ] `ai_reply_does_not_replace_dirty_form`에서 응답 중 직접 수정·화면 폭 변경·패널 열기/닫기 후 입력과 포커스가 유지됨을 검사한다. 선택 저장됨/조회 성공/실패·진짜 빈 기록을 별도로 검사한다.

```ts
expect(screen.getByLabelText("종료 시각")).toHaveValue("18:30");
expect(screen.getByRole("status").textContent).toContain("미저장");
expect(screen.queryByText("일정이 없습니다")).toBeNull(); // 조회 실패 fixture
```

- [ ] `npm exec vitest run -- tests/components/calendar-onboarding.test.tsx`로 실패를 확인한다.
- [ ] S1·S9–S13의 연결·제안·근거·보완·해제 후 선택·오류 복귀를 구현한다. 연결/선택 조회 완료 후 초안·분석·첫 질문을 명시적 진입 command로 준비하며 반복 effect가 질문을 중복 생성하지 않게 한다. 온보딩 재개 시 일반 조회를 갱신하고 기존 답변은 보존한다. 외부 AI에 전달되는 자료 범위를 설명하고 색 이외 텍스트 범례·키보드·좁은 화면을 제공한다.
- [ ] DOM 테스트·typecheck와 fixture 브라우저 흐름을 확인 후 커밋한다. **완료:** M3 시나리오가 동작하되 실제 Google 수집 성공은 T16에서 별도 확인한다.

**실행 기록 (2026-10-05):**
- DOM 테스트 `tests/components/calendar-onboarding.test.tsx`(4)를 추가했다: AI 응답 중 직접 수정 유지(리듀서 변이로 확인), 조회 실패 시 오류 표시(빈 기록으로 표시하지 않음), 데모 모드에서 Google 연결 미노출, 보정 저장 실패 시 입력 유지. 계획서의 `CalendarConnectionManager`·`EventDetailsPanel`·`EvidencePanel`은 별도 파일 없이 `CalendarSettings`·`ImportedEvents`·`OnboardingChat`·`WeekSchedule`에 구현되어 있다.
- 실제 Google 계정(읽기 전용 확인): 캘린더 목록 3개, 선택 캘린더 가져오기, '지난 8주 12건 중 업무 2·개인 10' 분석 문구까지 동작을 확인했다. `/onboarding`의 `fieldErrors`(null 프로토타입) 서버→클라이언트 전달 오류는 `getDraft`에서 일반 객체로 복사해 수정했고 회귀 테스트를 추가했다.
- 서버 뷰 확장(2026-10-05): ① 가져온 일정 뷰에 `allDay`·`startDate`·`endDate`·`timezone`을 추가하고 화면의 '자정이면 종일' 추정을 제거했다(DB에는 이미 있던 값). 뷰 스키마는 `contracts/calendar.ts`의 `importedEventViewSchema` 하나로 서버·화면이 공유한다. ② `aiClassification`(AI 제안)을 뷰에 추가했다. 현재 분류 규칙 버전(`schema_version`)의 가장 최근 제안을 모델과 무관하게 읽고(`event_classifications`에 생성 시각 컬럼이 없어 `rowid` 최신순을 사용, 마이그레이션 없음), 사용자 확인값(`classification`)과 분리해 표시한다. 일정 내용이 바뀌거나 규칙 버전이 다르면 제안은 보이지 않는다. 화면은 'AI 제안 · 개인' 배지, 힌트, 'AI 제안 적용'(적용만 하고 저장은 따로) 버튼을 제공한다. AI 분류는 최근 8주 일정에만 있으므로 미래 일정에는 그 사실을 안내한다.
- 내 캘린더에 Google 일정 표시(2026-10-05): `server/services/schedule-view.ts`의 `listCalendarItems`가 현재 일정 snapshot에서 선택된 캘린더의 일정과 바쁨만 공유된 구간을 읽고(소유자 전용, 외부 호출 없음), 거절·'한가함'·근무 위치·취소 일정은 일정 계산과 같은 기준으로 제외한다. `core/week.ts`가 종일 일정은 캘린더의 날짜(끝 날짜 제외)로, 시각 일정은 겹치는 모든 날에 배치한다. 화면은 읽기 전용 'Google Calendar' 항목, 종일·미정 표시, 마지막으로 가져온 시각과 Calendar 연결 링크를 보여 준다. 실제 계정으로 10/6~10/9 일정이 맞는 날짜·시각에 나오는 것을 확인했다.
- S1 나머지 구현(2026-10-05): ① 페이지 안 '일정 새로 가져오기': `/api/calendar/sync`에 선택적 `scope`(`full`|`future`)를 추가했고(`disconnect`는 범위 없음), 이 버튼은 일정 snapshot만 갱신하는 `future`(분석 snapshot이 없으면 `full`)를 쓴다. 실패하면 저장된 일정을 그대로 두고 그렇게 알린다. 선택한 캘린더 이름과 마지막 성공 조회 시각, '연결 관리' 링크를 보여 준다. 재연결 필요·선택만 저장한 상태·연결 없음도 각각 안내한다. ② S13 상세 패널: `GET /api/imported-events/[id]`와 `getImportedEventDetail`이 Google 원본(캘린더·상태·바쁨 여부·제공된 장소·화상회의 링크)을 읽기 전용으로 내려 주고, 같은 패널의 `EventAnnotationForm`(가져온 일정 목록과 공유)으로 분류·장소를 보완한다. 읽을 수 없는 장소는 '미확인'이다. 네이티브 `<dialog>`라 포커스 가둠·Esc·배경 비활성이 브라우저에서 동작하고, 닫으면 눌렀던 일정으로 돌아온다. 확정 미팅도 패널을 열 수 있다. ③ 충돌: `core/week.ts`의 `findConflicts`가 확정 미팅과 겹치는 외부 일정(바쁨 구간 포함)을 양방향으로 찾아 해당 일정에 '확정 미팅과 겹쳐요'/'겹치는 Google 일정 N건'을 표시하고 패널에 목록을 보여 준다. 수락 시점에 겹침이 없음을 검증했으므로 현재의 겹침은 모두 이후에 생긴 것이며, 확정 미팅을 자동으로 취소하지 않는다는 안내를 함께 둔다. ④ 중복 제거: 공급자 근거(iCalUID와 회차 원래 시각)가 같고 내용이 일치하는 사본만 한 건으로 묶어 캘린더 이름을 모두 보여 주고, 내용이 다른 사본이나 제목만 비슷한 일정은 묶지 않는다.
- 남은 것: 직접 추가한 일정은 삭제 버튼과 겹치므로 상세 패널을 열지 않는다. 요청함·보낸 요청(S7/S8)의 `conflict`는 여전히 항상 false이며 확정 충돌 투영이 필요하다(FR-63, F11). 실제 계정에는 확정 미팅이 없어 충돌 표시는 테스트로만 확인했고 화면에서 보지 못했다.
- 요청 화면 충돌 표시와 목업 계정(2026-10-05): ① `conflictingRequestIds`가 확정 미팅이 보는 사람 **본인의** 외부 일정과 겹치는지만 판단해(상대 캘린더는 보지 않음) 받은 요청함·내 요청의 수락된 요청에 '확정한 뒤 겹치는 일정이 생겼어요, 자동으로 취소되지 않아요'와 내 캘린더 해당 주 링크를 보여 준다(`weekIndexFor`). ② 목업 계정: 데모 모드 전용 `MockCalendarProvider`가 그 계정의 시드 일정을 Google API 모양으로 돌려주고, `connectMockCalendar`(데모 전용, 토큰 없음)가 연결 행을 만든 뒤 기존 목록→선택→가져오기 흐름이 그대로 동작한다. 화면은 'Google Calendar' 대신 '예시 Calendar'로 표시하고, 연결되면 같은 일정이 두 번 보이지 않도록 시드 항목을 숨긴다. ③ 계정별 확정 프로필(`persona-profiles.ts`, `db:reset`에서만 적용)을 서로 다르게 했다. 처음 설계한 이서연 프로필(평일 오전)은 그의 시드 일정이 10–12시를 이미 채우고 있어 후보가 0개였고(테스트가 잡음), 실제 빈 시간(12–15시, 화·목 18–20시)으로 고쳤다. ④ 실제·목업 인스턴스를 동시에 띄우도록 `NEXT_DIST_DIR`, `dev:mock`, `db:reset:mock`을 추가했다(DB·포트·빌드 폴더 분리). 목업 인스턴스에서 계정 전환→예시 Calendar 연결·가져오기→요청·수락→겹치는 일정 추가 후 새로 가져오기→내 캘린더·요청함의 충돌 표시를 브라우저로 확인했다.
- 추가 테스트: `tests/components/calendar-panel.test.tsx`(7), `tests/server/schedule-view.test.ts`(+3), `tests/server/annotations.test.ts`(+1), `tests/core/week.test.ts`(+1), `tests/contracts/inputs.test.ts`(+1). 사본 병합 제거·불일치 사본 병합·맞닿은 구간을 충돌로 취급·범위 미전송 변이에서 각각 실패함을 확인했다. 실제 계정에서 새로고침(마지막 조회 02:08→03:28)·패널 열기·Esc 닫기를 확인했다.
- 테스트: `tests/server/annotations.test.ts`(+2), `tests/server/schedule-view.test.ts`(4), `tests/core/week.test.ts`(4), `tests/components/calendar-onboarding.test.tsx`(+3). 거절 필터 제거·최신 제안 대신 가장 오래된 제안 사용·규칙 버전 무시·종일 끝 날짜 포함 변이에서 각각 실패함을 확인했다.

### T11. 상속 조건·정수 양쪽 순위·추천 근거

**선행:** T01·T07. **파일:** 생성 `src/core/preferences.ts`, `tests/core/preferences.test.ts`; 수정 `src/core/types.ts`, `filter.ts`, `summary.ts`, `options.ts`, `explain.ts`, `chips.ts`, 관련 `tests/core/*.test.ts`.

**인터페이스:** `resolvePreferences(snapshot: ProfilePreferences, overrides: PreferenceOverrides): EffectiveConditions`, `rankForParticipants(slots: Slot[], client: EffectiveConditions, host: ProfilePreferences, places: Place[]): RankedSlot[]`. 조건 타입은 T01의 core/types를 사용하고, RankedSlot은 같은 파일에서 clientScoreUnits·hostScoreUnits를 추가한다.

- [ ] `host_breaks_only_exact_client_ties`에서 client 점수 우위는 host가 뒤집지 못함, 같은 점수에만 host 반영, 명시 latest는 같은 날 늦은 시간 우선임을 검사한다. slack 30초 차이·3/4위 같은 시각 다른 양식·disabled 유지·방식/장소 이중 점수를 함께 검사한다.

```ts
expect(clientSlackScoreDelta).toBe(3 * 30_000);
expect(ranked.map(x => x.slot.placeId)).toEqual(expectedOrder);
expect(restoredFromDisabled.source).toBe("inherit");
```

- [ ] `npm exec vitest run -- tests/core`로 실패를 확인한다.
- [ ] 상속/override/disabled·정수 비교·명시 순서·최대 3개·60분 다양화·의미 있는 비교 키 판정을 구현한다. 선호 불일치와 must로 0개를 구분해 사실과 템플릿을 만든다.
- [ ] core 전체·typecheck·기존 규모의 60일 계산 1초 이내 검증을 통과시키고 커밋한다. **완료:** 단순 score 합산이나 epsilon 비교가 남지 않는다.

### T12. 독립 탐색·첫 응답·예약 조건 서비스

**선행:** T03·T04·T08·T11. **파일:** 생성 `src/server/repos/searches.ts`, `src/server/services/search.ts`, `tests/server/search.test.ts`; 수정 `services/chat.ts`, `schedule.ts`, `repos/conversations.ts`; 생성 Backend §5.3의 hosts·booking-entry·booking-searches·refresh·turns·conditions API `route.ts`.

**인터페이스:** `createSearch(..., input: CreateSearchInput, op): Promise<BookingSearchView>`, `refreshSearch(..., input: RefreshSearchInput, op): Promise<BookingSearchView>`, `changeConditions(..., input: ChangeConditionsInput, op): Promise<BookingSearchView>`, `sendSearchTurn(..., input: SearchTurnInput, op): Promise<BookingSearchView>`. 기존 interpret/respond는 새 조건·구조화 근거에 연결한다.

- [ ] `retries_initial_reply_without_duplicate_search`에서 생성 checkpoint 직후 중단·재시도에도 탐색 하나, 첫 응답 하나임을 확인한다. 같은 상대 새 작업은 새 ID, 양식 미정은 질문, 재방문은 기존 ID, 최신 기본값 적용은 override/disabled 보존을 검사한다.

```ts
expect(retry.searchId).toBe(first.searchId);
expect(initialReplies).toHaveLength(1);
expect(rebased.conditions.weekdays.state).toBe("disabled");
```

- [ ] `npm exec vitest run -- tests/server/search.test.ts`로 실패를 확인한다.
- [ ] Backend §8의 생성 checkpoint·상속 버전·최신 hard 규칙/host 선호·결과 자료 기준·stale/unavailable을 구현한다. 검색 중 '앞으로도'는 프로필 초안/복귀 안내를 반환하고 영구 값을 직접 쓰지 않는다. 기존 API는 같은 서비스에 위임하는 전환 어댑터만 유지한다.
- [ ] search·기존 chat 회귀·typecheck를 통과시키고 커밋한다. **완료:** 후보·출처·설명이 같은 계산 결과이며 렌더/GET은 메시지를 만들지 않는다.

**실행 기록 (2026-10-05):** `tests/server/search.test.ts`에 생성 중단 후 같은 키 재시도(탐색 1개·첫 응답 1개) 사례를 추가했다. 서비스 `src/server/services/search.ts`의 계획서 인터페이스 이름은 `searchTurn` 등 일부 다르다. 체크박스는 유지한다.

### T13. 최신 조회를 거치는 요청·수락

**선행:** T12. **파일:** 수정 `src/server/services/booking.ts`, `repos/requests.ts`, `repos/events.ts`, `repos/hosting.ts`, `services/schedule.ts`, 기존 requests·events·places·meeting-types API; 생성 `src/server/services/accept-impact.ts`, `tests/server/booking-concurrency.test.ts`, `src/app/api/requests/[id]/accept-preview/route.ts`; 확장 `tests/server/booking.test.ts`.

**인터페이스:** `createRequest(..., input: CreateRequestInput, op): Promise<RequestView>`, `acceptRequest(..., input: AcceptRequestInput, op): Promise<AcceptResult>`, `previewAcceptance(ctx, actorId, requestId: string): AcceptPreview`. Domain 입력은 Backend §5.3의 endAt·revision·impactToken을 포함한다.

- [ ] `accepts_once_after_fresh_receipts`에서 두 연결 동시 수락·commit 후 응답 유실에 accepted 하나·이벤트 정확히 둘을 검사한다. 한쪽 조회 실패, 자정/selection 변경, impact 집합 ID 교체, 양식 60→30분 변경은 상태 불변이어야 한다.

```ts
expect(bookingEvents).toHaveLength(2);
expect(changedImpact.error.code).toBe("accept_impact_changed");
expect(changedDuration.error.code).toBe("meeting_definition_changed");
```

- [ ] `npm exec vitest run -- tests/server/booking.test.ts tests/server/booking-concurrency.test.ts`로 실패를 확인한다.
- [ ] 외부 병렬 조회 후 IMMEDIATE transaction 안에서 영수증·현재 일정/규칙·원래 endAt·장소 의미를 재검증한다. 5분 impactToken·동일 host 자동 거절·양쪽 이벤트·작업 결과를 함께 저장한다. 수동 이벤트·장소·양식 변경도 revision과 작업 키를 적용하고 참조 설정은 비활성화한다.
- [ ] 임시 파일 DB 경합·기존 권한/철회/거절 회귀·typecheck를 통과시키고 커밋한다. **완료:** pending은 공용 슬롯을 막지 않으며 해제/프로필 변경은 accepted를 자동 삭제하지 않는다. 갱신 후 발견한 accepted 충돌을 요청 read model에 투영한다.

**실행 기록 (2026-10-05):** `tests/server/booking-concurrency.test.ts`를 추가했다: 두 연결의 동시 수락은 1건만 성공하고 이벤트가 정확히 2개, 같은 수의 자동 거절 대상이 다른 요청으로 바뀌면 `accept_impact_changed`, 5분이 지난 확인 토큰 거절. `checkImpact`의 집합 비교를 지우면 실패함을 확인했다. 체크박스는 유지한다.

### T14. 예약 탐색·요청함 화면 전환

**선행:** T05·T10·T12·T13. **파일:** 생성 `src/components/booking/SearchEntry.tsx`, `BookingWorkspace.tsx`, `PreferenceChips.tsx`, `MeetingTypePicker.tsx`, `AcceptConfirmation.tsx`, `tests/components/booking-workspace.test.tsx`, `src/app/(app)/book/[hostId]/search/[searchId]/page.tsx`; 수정 기존 `ChatView.tsx`, `RequestModal.tsx`, `OptionButtons.tsx`, `InboxGroup.tsx`, `SentRequests.tsx`, `HostSettings.tsx`, `(app)/book`·`requests`·`settings/host` 페이지.

**인터페이스:** Workspace는 BookingSearchView·T05 작업 훅을 사용한다. RequestModal은 부모의 message/selectedSlot·변경 callback을 받는다. AcceptConfirmation은 AcceptPreview·재확인 결과를 구분한다.

- [ ] `modal_reselection_keeps_message`와 `strict_mode_entry_is_one_operation`에서 닫기/후보 재선택 후 메시지 보존, 중복 effect 같은 키, reload 동일 searchId, 기본값 복귀 시 override 유지, 같은 수의 impact 대상 교체 시 재확인을 검사한다.

```ts
expect(screen.getByLabelText("요청 메시지")).toHaveValue(draftMessage);
expect(new Set(entryCalls.map(c => c.key)).size).toBe(1);
expect(acceptCalls).toHaveLength(1); // 영향 변경만으로 자동 재수락하지 않음
```

- [ ] `npm exec vitest run -- tests/components/booking-workspace.test.tsx`로 실패를 확인한다.
- [ ] S3–S8의 새 시작/이어가기·첫 후보·길이 선택·이번 조건 출처·영구 변경 복귀·실패/결과 불명확·수락 재확인을 연결한다. 렌더의 getOrCreate 호출을 제거하고 구 API/컴포넌트가 쓰이지 않으면 함께 제거한다. API 이중 쓰기 경로를 남기지 않는다.
- [ ] DOM 테스트·typecheck·브라우저 새로고침/뒤로가기/계정 전환을 확인 후 커밋한다. **완료:** 정확한 탐색 URL·입력 보존·새 후보 근거가 일치하고 S7/S8에 확정 충돌이 표시된다.

**실행 기록 (2026-10-05):** `tests/components/booking-workspace.test.tsx`(3: 요청 창을 닫아도 메시지 유지, 더블클릭 시 요청·멱등 키 1개, 칩 끄기 명령)를 추가했다. 쓰이지 않던 `ChatView`·`RequestModal`·`OptionButtons`·`FilterChips`는 미참조를 확인한 뒤 제거했다. 수락 재확인(`AcceptConfirmation`)은 별도 파일 없이 `InboxGroup`에 인라인으로 구현되어 있다. 임시 데모 DB에서 브라우저로 새 탐색→자연어 조건(칩 4개)→칩 해제→요청→호스트 수락→양쪽 확정 이벤트 2개까지 확인했다. 체크박스는 유지한다.

### T15. 기존 자료 이전 리허설·복원

**선행:** T14. **파일:** 생성 `scripts/db-migrate.ts`, `tests/server/migration-rehearsal.test.ts`; 수정 T02 migration, seed·reset, `README.md`, package scripts. 테스트에서만 쓰는 임시 DB와 백업 경로를 사용한다.

**인터페이스:** `npm run db:migrate -- --database <path>`는 모드·경로·적용 버전을 표시하고 일관된 backup 후 migration을 실행한다. 실패 시 원본을 임의 초기화하지 않고 복원 경로·진단을 남긴다.

- [ ] `restores_legacy_copy_after_failed_migration`에서 WAL에 기록이 있는 fixture를 backup API로 복사하고 고아 참조 실패→복원 후 기존 ID/본문/시각 일치를 확인한다. 정상 이전에서는 대기 요청의 원래 길이·확정 일정·대화 필터 의미를 확인한다.

```ts
expect(restored.logicalRows).toEqual(before.logicalRows);
expect(migrated.pendingRequest.endAt).toBe(originalEndAt);
expect(migrated.search.inheritedPreferences).toEqual(emptyPreferences);
```

- [ ] `npm exec vitest run -- tests/server/migration-rehearsal.test.ts`로 실패를 확인한다.
- [ ] backup·복원 실행 절차·schema checksum·FK 검사·대표 행 비교를 구현하고 T02 전환 어댑터 중 불필요한 것을 제거한다. 실제 모드 reset 차단, 신규 실제 DB 시드 없음, 앱 일정 보존을 문서화한다.
- [ ] 리허설 테스트·server 회귀·typecheck를 통과시키고 커밋한다. **완료:** 새 DB와 이전 DB가 동일 동작을 하며 실제 사용자 DB 이전은 이 작업의 자동 실행 대상이 아니다.

**실행 기록 (2026-10-05):** 이전 로직을 `src/server/db/migrate-copy.ts`로 분리하고 `npm run db:migrate -- SOURCE NEW_TARGET [demo|real]`을 추가했다. 복사본에만 이전하고 원본은 읽기 전용이며 실패 시 복사본을 제거한다(계획서의 제자리+backup 방식과 다르게 복사본 방식을 유지). `tests/server/migration-rehearsal.test.ts`(3)로 WAL을 열어 둔 원본, 고아 참조 실패 시 원본 바이트 불변, 기존 대상·충돌 모드 거절을 확인했고 정리 로직 변이에서 실패함을 확인했다. 미완료: `README.md` 갱신, 실제 사용자 DB 이전 리허설.

### T16. 통합·실제 연동·제품 검증 기록

**선행:** T15. **파일:** 생성 `tests/server/availability-flow.test.ts`, `tests/fixtures/onboarding-scenarios.ts`, `scripts/eval-onboarding.ts`, 구현 시 작성할 `docs/availability_onboarding/validation_report.md`; 수정 `README.md`, package scripts. 이 문서 작성 단계에서는 검증 보고서 파일을 미리 만들지 않는다.

**인터페이스:** 평가 스크립트는 고정 입력으로 해석 정확도·근거 일치·전체 턴 p50/p95·fallback을 출력한다. fixture 자동 검증과 실제 공급자·실제 모델 결과를 별도 구분한다.

- [ ] `profile_to_booking_end_to_end`에서 연결/skip → 초안 → 확정 → 첫 추천 → 이번 조건 변경 → 요청 → 수락 → 해제/프로필 변경까지 검증한다. AC-01–12별 자동/실제 검증 항목과 미확인 항목을 분리한다.

```ts
expect(result.request.status).toBe("accepted");
expect(result.afterDisconnect.bookingEventIds).toEqual(result.acceptedEventIds);
expect(result.newSearch.inheritedProfileVersion).toBe(result.latestProfileVersion);
```

- [ ] `npm exec vitest run -- tests/server/availability-flow.test.ts`를 실행해 새 경계 검증의 실패/통과 원인을 확인하고, 누락 구현이 있으면 담당 작업으로 돌아가 수정한다.
- [ ] 전체 `npm exec vitest run --`, `npm run typecheck`, `npm run build`를 실행한다. 고정 자료 슬롯 계산 1초 이내, 실제 온보딩 턴 p50 3초 목표의 달성 여부를 별도 기록한다. 초과 시 병목·관측값을 보고하며 timeout 안이라는 이유로 성능 목표 달성으로 표시하지 않는다.
- [ ] 허용된 테스트 계정으로 Google 연결·선택 캘린더·반복 변경/취소·재연결을 확인한다. 브라우저에서는 S0–S13, F01–F11을 실제 클릭·키보드·좁은 화면·reload·응답 유실 상황으로 검증한다. 실제 credential 미준비 항목은 명시적으로 미완료다.
- [ ] 직접 설정과 AI 제안 설정의 완료 시간·수정 이유, 새 탐색의 첫 후보 선택/해제 이유를 관찰해 보고서에 기록한다. 원본 개인 자료를 로그에 남기지 않는다. **완료:** 아래 수용 표의 증거를 채우고 문서·변경 범위 검토 후 구현 완료를 보고한다.

**실행 기록 (2026-10-05):**
- 추가: `tests/server/availability-flow.test.ts`(데모 모드에서 프로필→첫 추천→이번 조건 변경→요청→수락→프로필 v2 변경, 수락 이벤트 보존·새 탐색이 최신 버전 상속), `scripts/eval-onboarding.ts`와 `tests/fixtures/onboarding-scenarios.ts`(합성 VC 캘린더 스모크: 실제 Ollama, 임시 메모리 DB, 통과 조건 7개).
- 스모크 결과(마지막 실행, 종료 코드 0): 분류 커버리지 110/110, 허용 시간대 발화 해석 정확('평일 10–18시, 점심 제외'→월~금 10–12·13–18시, 약 2.9초), 선호 해석 정확(약 1.8초), 일정 기록만으로 허용 시간을 자동 생성하지 않음, 확정 프로필로 계산한 가능 슬롯 485개에 허용 시간 밖·일정 겹침·30분 격자 어긋남·2시간 리드 위반 0건. 이 수치는 고정 합성 자료와 실제 모델 한 번의 실행이다.
- 미완료: `validation_report.md`, 실제 Google 수집 AC 전체(반복 변경·취소·재연결 미검증), 해제 후 예약 보존 end-to-end, 브라우저 AC-01–12, 성능 p50/p95 공식 기록(위 수치는 참고용이며 목표 달성 기록이 아님).

## 5. 수용 기준과 구현 작업 연결

| 기준 | 구현·자동 검증 | 실제/브라우저 검증 |
|---|---|---|
| AC-01 실제 연결·소유권 | T06·T07·T08 | T16: 실제 계정 연결·다른 계정 접근 거부 |
| AC-02 반복 이동·취소·부분 실패 | T07·T08 | T16: 공급자 변경 후 반영 |
| AC-03 근무/미팅/선호 근거 | T09·T10 | T16: 늦은 사례를 예외로 질문하고 사용자 확인 |
| AC-04 복수 구간·점심 | T01·T04·T05·T07 | T16: 한국어 발화와 직접 편집 결과 비교 |
| AC-05 빈 자료·skip·장애·재개 | T03·T04·T05·T09 | T16: AI 장애 중 직접 설정·새로고침 |
| AC-06 새 상대/같은 상대 첫 추천 | T11·T12·T14 | T16: 길이 미정 질문·최대 3개 |
| AC-07 이번 조건·기본값 분리 | T11·T12·T14 | T16: 해제·복원·새 탐색·프로필 복귀 |
| AC-08 client 우선·host 동점 | T11·T12 | T16: 후보 순서·설명 사실 확인 |
| AC-09 선호 불일치·필수 0개 | T11·T12·T14 | T16: 자동 완화 없이 대안/수정 경로 |
| AC-10 장소·종일·방식 모호성 | T07·T08·T10 | T16: 패널 보완과 원본 변경 후 재확인 |
| AC-11 전송/수락 최신 조회 | T08·T13·T14 | T16: 추천 후 원본 변경·연결 실패 |
| AC-12 해제·변경·예약 보존 | T08·T13·T15 | T16: 해제 후 계속 사용·확정 충돌 표시 |

PRD 기능군은 진입/계정 FR-01–07 → T04–T06, 수집 FR-10–19 → T06–T08·T13, 분석/보완 FR-20–27 → T07–T10, 프로필 FR-30–38 → T01·T04·T05·T09·T10, 탐색 FR-40–47 → T11·T12·T14, 순위 FR-50–56 → T11·T12, 보존 FR-60–63 → T02·T08·T13·T15에 연결된다. NFR-01–07은 시간/계산 T01·T07·T11, 성능·실제 검증 T16, 모델 검증 T09, 데이터 경계 T06·T08–T10, 원자성 T03·T04·T08·T13에서 확인한다.

## 6. 외부 준비·실행 결과 기록

| 준비/위험 | 필요한 시점 | 진행 기준 |
|---|---|---|
| Google OAuth client·동의 설정·Calendar API·callback·테스트 계정 | T06 개발, T16 실제 검증 | 예제 환경 파일에는 이름만 기록. 준비 전 fixture 작업은 계속 진행 |
| token 암호화 키·impactToken 서명 키·실제/데모 DB 경로 | T06·T13 | 비밀값을 문서·브라우저·로그에 출력하지 않음 |
| 영속 SQLite를 지원하는 Node 실행 환경 | T02, 최종 실행 | 설치된 Next.js의 로컬 가이드를 읽고 Node runtime·서버 세션 동작을 확인 |
| OAuth/AI 지연·페이지 많은 캘린더 | T08·T09·T16 | 제한 초과는 자료 유지·명확한 재시도, 성공 범위 축소로 숨기지 않음 |
| 기존 untracked 파일·사용자 DB | 구현 시작·T15 | 작업 범위/backup을 확인하고 사용자 변경·원본을 보존 |

작업을 완료할 때 실행한 명령·실제 결과·남은 한계를 해당 T 작업 아래 기록하고 체크한다. 아직 실행하지 않은 테스트를 예상 결과만으로 완료 처리하지 않는다. 전체 기능 완료는 M6까지 통과한 뒤이며, M1의 수동 설정 시연이나 M3의 fixture 시연은 중간 결과다.

다음 **Repo Structure** 문서는 이 계획의 파일 책임을 최상위 배치·의존 방향·문서/테스트/스크립트 구분으로 정리한다. 현재 합의한 문서 작성 순서를 이어가며, 구현 방식 선택과 실행은 문서 검토 이후 별도 단계로 다룬다.
