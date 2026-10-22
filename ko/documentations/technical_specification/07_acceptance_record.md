# 인수 기록

> 한국어 번역본 (검토용). 원본: documentations/technical_specification/07_acceptance_record.md

상태: 1단계(`application-foundation`)와 2단계(`host-onboarding`) 증거 기록됨; 3단계(`requester-intake-and-feasibility`) 릴리스 기록됨, 인수 증거는 보류 중; 4단계(`host-review-and-booking`) 로컬 증거 기록됨, 프로덕션 증거 보류 중; 7단계(`requester-email-channel`) 로컬 증거 기록됨, 받은편지함과 프로덕션 증거 보류 중; 열린 공백은 아래에 나열

날짜: 2026-10-22

이 기록은 [구현 계획](06_implementation_plan.md)의 각 단계가 해당 단계의 증거 목록에 맞춰 만들어 낸 증거를 나열합니다. 모든 항목에는 실행한 명령, 날짜, 리비전, 환경이 명시되어 있습니다. 픽스처와 로컬 스택 실행은 로직을 증명할 뿐이며, **production**으로 표시된 항목만 배포된 연동을 증명합니다. 토큰, 시크릿, 이메일 주소, 개인 메시지 본문은 이 기록에 넣지 않습니다.

## 1단계 — `application-foundation`

변경: [`application-foundation`](../../openspec/changes/application-foundation/tasks.md). 증거 목록: [1단계](06_implementation_plan.md#phase-1--application-foundation).

### 환경

| 이름 | 설명 |
|---|---|
| 로컬 스택 | macOS의 Node.js 24.21.0에서 동작하는 Supabase CLI 2.119.0 로컬 스택(PostgreSQL 17). 마이그레이션은 `supabase db reset --local`로 적용하며, eve dev, 웹 서비스, 로컬 OpenAI 대역(stand-in)은 테스트 묶음이 시작함 |
| CI | `ubuntu-latest`와 Node.js 24에서 실행되는 GitHub Actions `Check` 워크플로: `application`, `database`(로컬 스택 후 통합 및 브라우저 테스트), `documentation` 작업 |
| Production | `https://findmeatime.com`과 `https://release.findmeatime.com`의 Vercel 프로젝트 `findmeatime-release`(Production, 함수는 `cle1`). 공유 Supabase 프로젝트 `anelszynxtvxoxqvzgqt`가 뒷받침함 |

### 테스트 묶음 실행

| 명령 | 날짜 | 리비전 | 환경 | 결과 |
|---|---|---|---|---|
| `supabase db reset --local` | 2026-10-19 | `8c6b474b` | 로컬 스택 | 전체 마이그레이션 체인을 다시 구축, 종료 코드 0 |
| `supabase test db` | 2026-10-19 | `8c6b474b` | 로컬 스택 | 파일 3개, pgTAP 테스트 47개 통과 |
| `npm run build`, `npm run lint`, `npm run typecheck` | 2026-10-19 | `8c6b474b` | 로컬 스택 | 각각 종료 코드 0 |
| `npm test` | 2026-10-19 | `8c6b474b` | 로컬 스택 | 파일 10개, 테스트 79개 통과 |
| `npm run test:integration` | 2026-10-19 | `8c6b474b` | 로컬 스택 | 파일 16개, 테스트 174개 통과 |
| `npm run test:e2e` | 2026-10-19 | `8c6b474b` | 로컬 스택 | Playwright 테스트 17개 통과, 첫 답장 여정은 로컬 OpenAI 대역을 상대로 실행 |
| `npm run check` | 2026-10-19 | `8c6b474b` | 로컬 스택 | 문서 링크와 `openspec validate --all --strict` 통과 |
| `Check` 워크플로, [run 39247520591](https://github.com/snuhcs-course/swpp-2026-project-team-01/actions/runs/39247520591) | 2026-10-19 | `8c6b474b` | CI | 세 작업 모두 통과: 단위 파일 10개 / 테스트 79개, pgTAP 파일 3개 / 테스트 47개, 통합 파일 16개 / 테스트 174개, 브라우저 테스트 17개 |

리비전 `8c6b474b`는 프로덕션에 배포된 리비전이기도 합니다. 이 브랜치에서 그 이후의 커밋은 문서만 변경합니다.

### 항목별 증거

각 항목은 이를 뒷받침하는 테스트 파일과 테스트 제목을 명시합니다. 항목에 달리 적혀 있지 않은 한, 모두 위의 테스트 묶음 실행(로컬 스택과 CI)에서 실행되었습니다.

**두 호스트 간 격리.** `tests/integration/conversations.test.ts`: "keeps one host out of another host's session". `tests/integration/recovery.test.ts`: "serves no history to another host". `tests/integration/eve-channel-auth.test.ts`: "denies a foreign or unindexed session ID".

**인가되지 않은 원본 런타임 라우트.** `tests/integration/eve-channel-auth.test.ts`를 `eve dev`와 `eve build` 후 `eve start` 아래에서 실행: "denies a request with no credential", "denies a current-project Vercel OIDC token", "denies a browser POST /eve/v1/session", "denies a browser POST /eve/v1/session/:sessionId", "denies an expired or tampered internal bearer", "denies a foreign or unindexed session ID", "denies a stale generation", "denies a signed-out session", "denies a fixture-suspended host", "lets a read bearer read only the session it names". 각 거부는 모델 작업이 없고 기록된 이벤트도 없음을 단언합니다. `tests/integration/eve-surface.test.ts`: "reports health without revealing configuration". `tests/integration/data-api-exposure.test.ts`와 `supabase/tests/app_grants.test.sql`은 `anon`과 `authenticated`가 어떤 애플리케이션 테이블이나 함수에도 닿지 않음을 보여 줍니다.

**취소되었거나 재생된 로그인.** `tests/integration/google-sign-in.test.ts`: "establishes no session when Google sign-in is cancelled", "establishes no session when the code is replayed", "establishes no session when the callback arrives in another browser", "returns a completed sign-in to /app with a session, ignoring a supplied destination", "rejects an email sign-in request without sending mail", 그리고 둘 이상의 오리진에 대해 "starts and finishes sign-in on the origin the request came to"와 "refuses an unlisted host, whether in the URL or a forwarded header, without redirecting". Google 쪽 구간은 로컬 Supabase Auth를 상대로 시뮬레이션합니다.

**재연결 대 종료 상태 복구.** `tests/integration/recovery.test.ts`: "reads history in order across a recovered conversation, from any cursor"(오래된 커서에서의 재연결), "creates one successor for concurrent and repeated recovery", "refuses uncertain runtime state", "recovers a recorded model-authentication failure after the key is corrected, keeping prior charges", "denies the model when allowance is exhausted during recovery, keeping history readable", "denies recovery when authority is revoked while it waits for its lock", "denies a retired generation a model reservation", "continues input accepted after the failure with its original identity". `tests/e2e/workspace.test.ts`: "Restart Thyme recovers a failed conversation and keeps the message once".

**모델 한도 소진.** `tests/integration/model-limits.test.ts`: "reserves only the principal's remaining capacity under concurrent work", "reserves only the service's remaining capacity under concurrent work", "caps a conversation input at eight attempts", "denies an unattributable call before any provider request or reservation", "enforces the output cap, storage off and the standard tier over the caller's options"와 마감 시간 테스트. `tests/integration/conversations.test.ts`: "reserves every provider call of a turn with a forced retry and a forced compaction". `tests/e2e/workspace.test.ts`: "saved history stays readable after the model allowance is exhausted".

**프리뷰 메시징과 워커 거부.** `lib/server/messaging.test.ts`: 프리뷰, Vercel 개발, 모순되는 배포 메타데이터에 대한 "refuses %s before any network call"과 "leaves delivery state untouched when %s wakes a delivery worker". `tests/integration/job-worker.test.ts`: 프로덕션이 아닌 일곱 환경에 대한 "refuses on %s before touching job state"와 "leaves a preview-produced job unclaimed and visible while production work runs".

**AC-26, 전반부.** `tests/integration/host-admission.test.ts`: "creates one active host account on first sign-in", "returns the same account on a repeated sign-in", "creates one account for two concurrent callbacks of one identity"; "rejects a suspended host's operation without changing host data"는 가드를 다룹니다. 같은 파일의 "lets an active host operate but gives an unready host no public profile"은 1단계에서는 자명하게 통과합니다. 설정을 완료할 수 있는 호스트가 없고 공개 프로필 라우트도 없으므로 준비도는 항상 false입니다. AC-26의 설정 전 게시 방지와 정지 부분은 2단계 증거입니다.

**체인이 다시 구축됨.** 위 테스트 묶음 실행의 `supabase db reset --local`과 CI `database` 작업의 "Start the local stack and apply the migration chain" 단계.

**실제 모델의 첫 답장.** 2026-10-19 리비전 `223152a5`에서 실제 `gpt-5.6-terra`를 사용한 로컬 스택의 `E2E_LIVE_MODEL=1 npm run test:e2e`: `tests/e2e/first-reply.test.ts` "a new host signs in, lands on /app with an empty setup session and gets Thyme's first reply"가 통과했습니다. 브라우저는 실제 `/auth/sign-in`과 `/auth/callback` 라우트로 로그인했고, 색인된 빈 1세대 설정 세션이 있는 `/app`에 도착했으며, 모델 예약 1건과 함께 스트리밍된 답장(추가된 메시지 이벤트 16개)을 받았습니다. 플래그가 없으면 같은 여정이 모든 브라우저 실행에서 로컬 대역을 상대로 실행됩니다.

### 프로덕션 배포

2026-10-19에 리드가 리비전 `8c6b474b`의 **production** 배포를 대상으로 실행했습니다.

| 점검 | 명령 | 결과 |
|---|---|---|
| 푸시 전 공유 프로젝트 | `supabase migration list --linked`, `pg_namespace` 읽기 | 애플리케이션 스키마 없음, 원격 마이그레이션 없음 |
| 마이그레이션 | `supabase db push --linked --dry-run` 후 `supabase db push --linked` | 마이그레이션 14개가 나열되고 적용됨; `supabase migration list --linked`가 14개를 보여 줌 |
| 스키마 드리프트 | `supabase db diff --linked` | 프로젝트에 미리 설치되어 있고 체인이 선언하지 않은 `CREATE EXTENSION pgmq`뿐; 애플리케이션 드리프트 없음 |
| Auth 구성 | `supabase config push` 후 `supabase config diff` | Site URL `https://findmeatime.com`과 콜백 URL 세 개가 적용됨; 남은 업데이트 없음; Google 제공자는 변경 없음 |
| 워커 깨우기 | Vault 항목과 `app-jobs-sweep` 크론 이력 | 정식 오리진의 워커 URL; 매분 실행되는 스윕이 성공 |
| 함수 리전 | 프로덕션 배포에 대한 `vercel inspect` | 함수는 `cle1` |
| 도메인 | `vercel domains inspect findmeatime.com` | `findmeatime-release`가 `findmeatime.com`과 `release.findmeatime.com`을 제공 |
| DNS | `dig +short A findmeatime.com @1.1.1.1`과 `release.findmeatime.com`에 대한 동일 명령 | 둘 다 Vercel이 요구하는 주소로 해석됨; Cloudflare 레코드는 DNS 전용 |
| 두 오리진의 HTTPS | `/`, `/app`, `/eve/v1/health` 요청 | 각각 200 |
| 원본 런타임 라우트 | 인증되지 않은 `POST /eve/v1/session` | 401 |
| 워커 라우트 | 시크릿 없음, 틀린 시크릿, 올바른 시크릿으로 `POST /api/internal/jobs` | 401, 401, 처리된 것이 없는 200 |
| 로그인 시작 | 각 오리진의 `GET /auth/sign-in` | 해당 오리진의 `/auth/callback`, PKCE S256, 오프라인 접근, Calendar 스코프 세 개와 함께 Supabase Auth로 303 |
| 헤더 | 응답 헤더 | Content Security Policy와 HSTS 있음 |
| 로그인한 턴 | 팀원이 `https://findmeatime.com`에서 실제 Google 로그인을 한 뒤 `/app`에서 메시지 한 건 | `/app`에 도착; Thyme의 답장이 스트리밍됨. 데이터베이스에는 호스트 계정 1개, Google 신원 1개, Calendar 스코프 세 개와 봉인된 리프레시 토큰 1개가 있는 제공자 권한 부여 1개, 색인된 세션 1개, 완료된 입력, 모델 예약 1건이 있었음 |

### 알려진 공백

- **배포 워크플로 시크릿.** `Deploy shared Supabase` 워크플로의 저장소 시크릿과 변수가 설정되지 않아 한 번도 실행되지 않았으며, 작업 2.3은 열려 있습니다. 지금까지의 푸시 한 번은 [제공자 설정](03_provider_setup.md#environments-and-collaboration)에 기록된 대로 수동이었습니다.
- **두 번째 오리진 로그인.** `https://release.findmeatime.com`에서 로그인한 사람은 아직 없으며, 리디렉션과 허용 목록 항목만 검증되었습니다.
- **Google OAuth 게시 상태**는 기록되지 않았으며, 작업 2.8의 샌드박스 콜백 등록은 열려 있습니다.
- **`pg_net` 권한 부여.** 플랫폼이 `net.http_request_queue`와 `net._http_response`에 대한 `PUBLIC` 접근을 부여하며 `postgres`는 이를 회수할 수 없습니다. 애플리케이션은 `net`을 Data API 밖에 두지만(`tests/integration/data-api-exposure.test.ts`), 대기열에 쌓인 깨우기에는 워커 시크릿이 잠시 담깁니다. 호스팅된 프로젝트에서는 점검하지 않았습니다.
- **가입 예산.** 가입을 완료한 Google 계정은 모두 자신의 모델 허용량을 가진 활성 호스트가 되므로, 많은 가입이 공유 상한을 소진시킬 수 있습니다. OAuth 앱의 테스트 대상자 제한이 현재는 이를 제한하며, 2단계는 앱을 게시하기 전에 가입 통제를 추가합니다.
- **오래된 Vercel 변수.** 이전 프로토타입이 남긴 변수가 `findmeatime-release`에 사용되지 않은 채 남아 있습니다. 제거하십시오.

## 2단계 — `host-onboarding`

변경: [`host-onboarding`](../../openspec/changes/host-onboarding/tasks.md). 증거 목록: [2단계](06_implementation_plan.md#phase-2--host-onboarding). 환경은 1단계와 같으며, 브라우저 및 통합 테스트 묶음은 토큰 엔드포인트와 Calendar API를 위한 로컬 Google 대역(`tests/e2e/support/fake-google-server.ts`, `tests/integration/support/fake-google.ts`)도 실행합니다.

### 테스트 묶음 실행

| 명령 | 날짜 | 리비전 | 환경 | 결과 |
|---|---|---|---|---|
| `supabase db reset --local` 후 선언적 동기화 | 2026-10-19 | `beff3899` | 로컬 스택 | 체인이 다시 구축됨; 동기화가 마이그레이션을 생성하지 않음(드리프트 없음) |
| `supabase test db` | 2026-10-20 | `3aa0ad86` | 로컬 스택 | 파일 4개, pgTAP 테스트 59개 통과 |
| `npm run build`, `npm run lint`, `npm run typecheck` | 2026-10-20 | `3aa0ad86` | 로컬 스택 | 각각 종료 코드 0(1단계 파일에 린트 경고 세 개) |
| `npm test` | 2026-10-20 | `3aa0ad86` | 로컬 스택 | 테스트 232개 통과 |
| `npm run test:integration` | 2026-10-20 | `3aa0ad86` | 로컬 스택 | 테스트 281개 통과 |
| `npm run test:e2e` | 2026-10-20 | `3aa0ad86` | 로컬 스택 | Playwright 테스트 28개 통과, 로컬 OpenAI 및 Google 대역을 상대로 실행 |
| `npm run check` | 2026-10-20 | `3aa0ad86` | 로컬 스택 | 문서 링크와 `openspec validate --all --strict` 통과 |

### 항목별 증거

**AC-26, 웹 및 직접 API 경로.**
- *계정 하나, 중복 없음:* `tests/integration/host-admission.test.ts`의 1단계 테스트가 여전히 통과합니다.
- *설정 전 게시 없음:* `tests/integration/setup-tools.test.ts` "returns links only once the host is ready"; `tests/integration/setup-confirm.test.ts` "rejects a stale review by revision or by proposal, saving nothing"; `tests/integration/entry-documents.test.ts` "gives the same neutral 404 for invalid, reserved, unknown, released, unready and suspended hosts". 직접 API 경로는 `/api/setup/commands`입니다(`tests/integration/setup-state.test.ts` "serves the signed-in host's state privately and runs card commands with their revisions", "refuses a signed-out request and a cross-site command").
- *설정 완료:* `tests/e2e/host-setup.test.ts` "a new host completes setup from the authored messages to working public pages"; `tests/integration/setup-confirm.test.ts` "makes the host ready with its links on the configured origin".
- *정지와 복원:* `tests/integration/operator.test.ts` "suspends a host: hosting is refused and the public profile disappears, with an audit row", "restores a host by account ID with its saved setup and public profile", "denies the operator function to Data API roles"; `tests/integration/setup-tools.test.ts` "denies a retired generation, a suspended host and another audience before reading".
- *남용 한도:* `tests/integration/signup-limits.test.ts`(세 개 모두); `tests/integration/handles.test.ts`(일곱 개 모두).
- *보류:* MCP와 CLI 경로(해당 인터페이스가 처음 존재하게 되는 5단계; 지금은 존재하지 않으므로 어느 것도 게시할 수 없음), 그리고 활성 호스트에 대한 요청자 캘린더 연결과 계정 없는 연락(3단계).

**AC-28.**
- *실제 메타데이터에서 가져온 이유가 있는 캘린더; 중복 이름; 읽기 전용 대상:* `tests/integration/google-calendar.test.ts` "lists actual calendars by provider identity, keeping two with the same name apart"; `tests/integration/calendar-roles.test.ts` "rejects a read-only destination and keeps the previous roles"; `tests/integration/setup-state.test.ts` "lists the live calendars with recommendations while choosing calendars".
- *선택한 캘린더의 분석, 부분 및 실패한 읽기, 폐기된 접근:* `tests/integration/calendar-analysis.test.ts` "stores the evidence dimensions of the saved conflict calendars", "discloses a partial failure, stores no evidence and commits the failure", "records a revoked grant as a failed scan and marks the grant invalid", "does not scan again on reload or redelivery"; `tests/integration/setup-state.test.ts` "reports a revoked grant instead of an empty calendar list", "asks a ready host whose Google access was revoked to connect Calendar again".
- *제안 우선, 표시, 희박한 근거, 존중되는 수정:* `lib/server/analysis.test.ts`와 `lib/server/setup.test.ts`의 단위 테스트(작은 표본 대체, 우선순위); `tests/integration/setup-commands.test.ts` "refuses Use this as stale when the proposed value is no longer the one shown"; `tests/integration/setup-tools.test.ts` "writes values unaccepted and labeled, and rejects a stale revision".
- *오래된 검토:* `tests/e2e/host-setup.test.ts` "a stale review is rejected and nothing is saved".
- *브라우저 복귀 후 재개:* `tests/e2e/host-setup.test.ts` "declined Calendar scopes show Connect Google Calendar with the consent link"; 아래 동의 리디렉션의 프로덕션 점검.
- *모바일과 키보드:* `tests/e2e/host-setup.test.ts` "the review card works by keyboard alone"와 여정의 390 및 1280 픽셀 레이아웃 단언; 동작 줄이기(reduced-motion) 노출 테스트.
- *보류:* 인라인 iMessage 연결 또는 건너뛰기(6단계).

**온보딩 체크리스트의 FR-04 점검.**
- *방식, 장소, 이동 수단이 명시적임; 온라인 전용이면 이동 수단을 건너뜀:* `tests/integration/setup-tools.test.ts` "cannot answer mode, location or transport without source stated, or replace the host's answer"; `tests/e2e/host-setup.test.ts` "a mode the assistant recorded shows as You said and counts only after Use this"; `tests/integration/setup-state.test.ts` "moves to confirmation once the host answers the mode, and writes on read only the first browser zone".
- *기본값을 관찰된 것으로 설명하지 않음:* `lib/server/analysis.test.ts`의 시작 기본값 이유와 `apps/web/app/_components/setup/format.test.ts`의 출처 배지.
- *준비된 이후에만 링크:* 위의 AC-26 참조.
- *분석 근거는 만료되고 채택된 값은 남음:* `tests/integration/analysis-cleanup.test.ts` "removes expired rows in bounded passes and keeps recent ones", "skips a row another transaction holds and removes it on a later pass", "leaves adopted draft and confirmed values untouched".

**1단계에서 미뤄진 대화 접근 시나리오.** "커밋 후 도구 결과 유실": `tests/integration/setup-tools.test.ts` "replays a call with the same call ID without a second write"와 "replays the saved outcome after the host accepted the drafted value on its card". "실패 전 커밋된 도구 결과": "does not advance the revision for identical values under a new call ID". 대상별 등록: `tests/integration/eve-channel-auth.test.ts`는 호스트 설정 모델 요청이 `eve dev`와 빌드 모두에서 `read_setup_state`, `draft_settings`, host-setup 조각을 담고 있음을 단언하며, `npx eve info`는 `tools/setup.ts`를 동적 리졸버로 나열합니다.

### 프로덕션 배포

2026-10-20에 리드가 리비전 `3aa0ad86`(`dpl_42ZqP3jUaHC25Y4VFFhrnwRvv4XK`)의 **production** 배포를 대상으로 실행했습니다.

| 점검 | 명령 | 결과 |
|---|---|---|
| 푸시 전 공유 프로젝트 | `supabase migration list --linked` | 1단계 마이그레이션 14개 적용됨, 2단계 마이그레이션 2개 대기 중 |
| 마이그레이션 | `supabase db push --linked --dry-run` 후 `supabase db push --linked` | `20261019144149_host_onboarding.sql`과 `20261019144158_schedule_analysis_cleanup.sql`이 나열된 뒤 적용됨; `supabase migration list --linked`가 16개를 보여 줌 |
| 스키마 드리프트 | `supabase db diff --linked` | 1단계와 같이 미리 설치된 `pgmq` 확장뿐 |
| 배포 | `vercel deploy --prod`, `vercel inspect` | Ready; `findmeatime.com`과 `release.findmeatime.com`에 별칭 지정됨 |
| 두 오리진의 진입 문서 | `/SKILL.md`, `/llms.txt`, `/nobody-here/SKILL.md`, `/app/SKILL.md`의 `curl` | Markdown 200, 텍스트 200, 404, 404; `cache-control: no-store`; `set-cookie` 없음 |
| Markdown 협상 | 두 오리진에서 `curl -H "Accept: text/markdown" /` | 200 `text/markdown`, `Vary: Accept`, 쿠키 없음 |
| 갱신된 Calendar 동의 | 두 오리진의 `GET /auth/sign-in?consent=calendar` | 해당 오리진의 콜백, `prompt=consent`, `include_granted_scopes=true`, 오프라인 접근, PKCE S256과 함께 Supabase Auth로 303 |
| 설정 API | 인증되지 않은 `GET /api/setup/state`; 교차 사이트 `POST /api/setup/commands` | 401; 403 |

수동 푸시는 [설계](../../openspec/changes/host-onboarding/design.md#migration-plan)에 기록된 예외입니다. 배포 워크플로의 시크릿이 아직 설정되지 않았으므로 사용자가 2026-10-20에 다시 승인했습니다.

### 알려진 공백

- **프로덕션에서 로그인한 설정.** 팀원이 `https://findmeatime.com`에서 실제 Google로 로그인해 설정을 완료하고 그 결과인 `/{handle}`과 `/{handle}/SKILL.md`를 여는 점검이 보류 중입니다. 이는 이 변경보다 먼저 존재한 Vercel Production의 `GOOGLE_CLIENT_ID`와 `GOOGLE_CLIENT_SECRET`이 Supabase Auth가 사용하는 클라이언트와 같은지도 확인해 줍니다. 불일치하면 캘린더 카드에서 Calendar 사용 불가로 나타납니다.
- **Google 앱 검증.** OAuth 앱은 **Testing** 상태입니다(2026-10-20 사용자 보고). 등록된 테스트 사용자만 로그인할 수 있고, 리프레시 토큰이 7일 뒤 만료되어 저장된 Calendar 권한 부여가 매주 무효화됩니다(그러면 호스트에게 **Connect Google Calendar**가 보입니다). **In production**으로 옮기고 민감한 Calendar 스코프의 검증을 제출하는 것은 프로젝트 소유자의 콘솔 작업입니다.
- **실제 Google Calendar 데이터.** 로그인한 프로덕션 점검이 실행되기 전까지 분석과 역할은 대역을 상대로만 검증되었습니다.
- **핸들 확인 속도.** `/api/setup/handle`에는 속도 제한이 없으며, 설계에 위험으로 기록되어 있습니다.
- **호스트 페이지 상태 코드.** 이용할 수 없는 `/{handle}` 페이지는 스트리밍되는 페이지가 상태를 바꿀 수 없으므로 상태 200과 `noindex`로 중립적인 찾을 수 없음 화면을 렌더링하며, `SKILL.md` 라우트는 실제 404를 반환합니다.

## 3단계 — `requester-intake-and-feasibility`

이 변경은 풀 리퀘스트 세 건으로 병합되고 릴리스되었습니다. 인수 증거(작업 7.1)는 아직 기록되지 않았으며, 이 절은 지금까지의 릴리스를 기록합니다. 그 뒤에 있는 모든 결정은 [결정 기록](08_decision_log.md#phase-3--requester-intake-and-feasibility)에 있습니다.

### 프로덕션 배포

2026-10-22에 리드가 **production** 배포 `findmeatime-release`를 대상으로 실행했습니다.

| 절차 | 리비전과 배포 | 명령 | 결과 |
|---|---|---|---|
| PR #26 병합(관리자 우회) | `5f2681ea` | `supabase migration list --linked` 후 `supabase db push --linked --dry-run` | 1·2단계 마이그레이션 16개가 적용됨; `20261021110927_requester_intake_and_feasibility.sql`, `20261021110942_request_expiry_schedule.sql`, `20261021135225_model_reservation_anonymous.sql`이 나열됨. `supabase db diff --linked`는 3단계 객체와 미리 설치된 `pgmq` 확장만 보여 줌 |
| 마이그레이션 | `5f2681ea` | `supabase db push --linked` | 세 개가 적용됨; 19개가 나열됨 |
| 배포 | `5f2681ea`, `dpl_HboMKsV1Lhgn31p1hvwWAiioGYUe` | `origin/main`의 깨끗한 체크아웃에서 `vercel deploy --prod` | Ready; `findmeatime.com`과 `release.findmeatime.com`에 별칭 지정됨 |
| PR #27 병합(관리자 우회) | `fdccf26e`, `dpl_MoVx2TjuyxmyjtseY3GzK4javxKx` | `vercel deploy --prod` | Ready; 마이그레이션 없음 |
| PR #28 병합(관리자 우회) | `9415fe11` | `supabase db push --linked --dry-run` | `20261021191248_guest_draft_requests.sql`과 `20261021194840_guest_calendar_step.sql`이 나열됨 |
| 마이그레이션 | `9415fe11` | `supabase db push --linked`, `supabase migration list --linked` | 둘 다 적용됨; 21개가 나열되고 대기 중인 것은 없음 |
| 배포 | `9415fe11`, `dpl_3PDifXmnhwYn59rdBdSo3cBYwdxM` | `origin/main`의 깨끗한 체크아웃에서 `vercel deploy --prod` | Ready |
| 각 배포 후 스모크 테스트 | `9415fe11` | `/`, `release.findmeatime.com/`, `/app`, `/SKILL.md`, `/llms.txt`, 준비된 호스트의 `/{handle}`과 `/{handle}/SKILL.md`, 알 수 없는 `/booking/{uuid}`의 `curl` | 모두 200. 예약 화면은 `referrer-policy: no-referrer`, `x-robots-tag: noindex`, `cache-control: no-store`를 보내며 **Resend my booking link**를 제공함. 폐기된 `/api/intake/{handle}/messages`는 404를 반환함. 호스트 문서에는 요청을 받는다고 적혀 있음 |
| 공개 페이지 | `9415fe11` | 브라우저, 메시지는 보내지 않음 | 호스트 헤더, 접힌 에이전트 및 재전송 구역, 시간대 줄, 입력창이 있는 빈 스레드; 스레드 밖에는 폼이 없음 |
| Google 리디렉션 URI | — | 호스트 클라이언트와 각 콜백으로 Google 인증 엔드포인트 요청, 로그인은 하지 않음 | 세 개의 `/connections/google/callback` URI는 로그인 페이지에 도달함; 등록되지 않은 URI는 `redirect_uri_mismatch`를 받음 |

수동 푸시는 1·2단계의 예외를 되풀이한 것입니다. 배포 워크플로의 시크릿이 아직 설정되지 않았으므로 사용자가 2026-10-22에 각각 승인했습니다. 병합된 리비전의 로컬 테스트 묶음은 풀 리퀘스트에 나열되어 있습니다. 단위 테스트 384개, 통합 테스트 459~460개, 게스트 Playwright 여정, 빌드, `npm run check`입니다.

### 알려진 공백

- **인수 증거(작업 7.1).** 프로덕션에서 수신 및 후보까지의 AC-01, AC-02, 요청자 측 AC-03, AC-12, 철회에 대한 AC-13, AC-27과, 생성 이메일과 그 확인 링크 및 재전송된 링크의 통제된 Cloudflare 전달이 보류 중입니다. 프로덕션에서는 메시지를 보내지 않았습니다.
- **Routes API.** `GOOGLE_MAPS_API_KEY`에 대해 활성화되었는지 확인되지 않았으며, 서울 실시간 경로 점검(작업 5.2)은 실행되지 않았습니다.
- **실제 모델 평가(작업 6.4).** 실행하지 않았습니다.
- **요청자 Google 동의.** 리디렉션 URI는 등록되었으며, 테스트 사용자로 한 동의는 완료되지 않았습니다.
- **공유 프로젝트 데이터.** 이전의 테스트 수신과 요청이 남아 있으며 삭제하지 않았습니다.

## 4단계 — `host-review-and-booking`

변경: [`host-review-and-booking`](../../openspec/changes/host-review-and-booking/tasks.md). 증거 목록: [4단계](06_implementation_plan.md#phase-4--host-review-and-booking). 환경은 1단계와 같으며, 로컬 Google 대역은 `events.insert`와 `events.get`(고정 이벤트 ID, 중복 시 `409`, 생성 전후의 응답 유실)으로 확장되고 로컬 Cloudflare 대역은 `reply_to`와 첨부 파일을 기록합니다. 여기의 어느 것도 프로덕션에서 실행되지 않았습니다.

### 테스트 묶음 실행

| 명령 | 날짜 | 리비전 | 환경 | 결과 |
|---|---|---|---|---|
| `supabase db reset --local` 후 선언적 동기화 | 2026-10-22 | `b45b794d` | 로컬 스택 | `20261022021159_host_review_and_booking.sql`로 체인이 다시 구축됨; 동기화가 추가 마이그레이션을 생성하지 않음 |
| `supabase test db` | 2026-10-22 | `70f5fb63` | 로컬 스택 | 파일 6개, pgTAP 테스트 92개 통과, `host_review_booking.test.sql` 포함 |
| `npm test` | 2026-10-22 | `70f5fb63` | 로컬 스택 | 테스트 404개 통과(파일 41개) |
| `npm run test:integration` | 2026-10-22 | `70f5fb63` | 로컬 스택 | 테스트 495개 통과(파일 47개), 영수증에 맞춰 닫힌 화면 단언 두 개를 고친 뒤 |
| `npm run test:e2e` | 2026-10-22 | `70f5fb63` | 로컬 스택 | Playwright 테스트 35개 중 34개 통과; 3단계 요청자 여정이 1280 픽셀에서 병렬 실행 중 제목 포커스를 놓쳤고, 단독으로 다시 실행했을 때는 통과 |

### 항목별 증거

픽스처와 로컬 스택 증거뿐이며, 각 항목은 이를 보여 주는 테스트를 명시합니다.

| 항목 | 증거 |
|---|---|
| AC-01 전체 | 합의까지의 3단계 `tests/e2e/requester-intake.test.ts`, 이어서 390 및 1280 픽셀의 `tests/e2e/host-review.test.ts` "the host approves from the inbox and both sides see the receipt": 받은 요청함, 승인, 예약 작업, **미팅 참여(Join meeting)**가 있는 호스트 영수증과 예약 링크의 요청자 영수증 |
| AC-03 | `tests/integration/host-requests.test.ts` "holds every candidate in a full week until the host waives the limit"와 "applies a host allowance for an unresolved trip of one candidate": 요청자 투영에는 규칙, 한도, 허용이 없음 |
| AC-04 | `host-requests.test.ts` "shares a feasible later time as a checked new version": 이전 버전은 더 이상 승인할 수 없고, 요청자가 동의한 뒤 호스트가 다시 승인함 |
| AC-06 웹 전용 | `tests/integration/bookings.test.ts` "returns the same booking to a second approval with another retry key" |
| AC-07 | `bookings.test.ts` "stops at revalidation when a busy event appeared"와 "dispatches only one of two competing bookings for the same host" |
| AC-08 | `bookings.test.ts` "reconciles a lost response by reading the event, never inserting twice"와 "inserts the same frozen payload again when the first insert never arrived" |
| AC-09 | `bookings.test.ts` "fails definitively on a refused write and lets the host retry", "records revoked Calendar access"; `tests/integration/booking-emails.test.ts` "keeps the booking confirmed when a copy bounces, and sends nothing twice" |
| AC-10 웹 전용 | `tests/integration/host-review.test.ts`: 비공개 논의의 "Approve it and book it."은 아무것도 기록하지 않으며 세션에는 호스트 검토 도구만 나열됨; 요청자 쪽은 3단계의 것 |
| AC-13 | `bookings.test.ts` "lets the requester withdraw a reserved booking", "refuses withdrawal and decline once dispatch may have begun", "declines with the requester's status email"(늦은 승인은 `request_closed`로 답함), "cancels a reserved booking whose request expired" |
| 확인 일관성 | `booking-emails.test.ts` "sends each party a copy with the host's name, Reply-To the other party and the matching calendar part"; 두 언어와 캘린더 파트에 대한 `lib/server/booking-emails.test.ts` |

### 알려진 공백

- **통제된 Google Calendar와 받은편지함.** 팀이 통제하는 Google Calendar의 확정된 이벤트와, 팀이 통제하는 받은편지함에 캘린더 파트가 포함된 확인 메일이 보류 중입니다. 마이그레이션이 공유 프로젝트에 없고 프로덕션도 다시 배포되지 않았습니다(결정 기록의 "사용자 대기 항목").
- **Cloudflare 첨부 파일.** Cloudflare의 REST API가 전달한 `text/calendar` 첨부 파일을 Gmail과 Outlook이 초대로 처리하는지는 검증되지 않았습니다.
- **알림**은 D3에 따라 미뤄졌습니다.

## 7단계 — `requester-email-channel`

변경: [`requester-email-channel`](../../openspec/changes/requester-email-channel/tasks.md). 증거 목록: [7단계](06_implementation_plan.md#phase-7--requester-email-channel). 환경은 1단계와 같으나, 병렬로 진행된 5단계 세션의 스택을 초기화하지 않도록 로컬 스택은 별도의 것(`project_id` `fmat-phase7`, 포트 553xx)이었고([결정 기록](08_decision_log.md#phase-7--requester-email-channel)), 로컬 AgentMail 스탠드인(`tests/integration/support/fake-agentmail.ts`)이 메시지 API를 제공하고 답장을 기록하며 `Idempotency-Key`를 따랐습니다. 받은편지함은 존재하지 않으며 AgentMail이나 프로덕션을 상대로 실행된 것은 없습니다.

### 테스트 묶음 실행

| 명령 | 날짜 | 리비전 | 환경 | 결과 |
|---|---|---|---|---|
| `supabase db reset --local` 후 선언적 동기화 | 2026-10-22 | `aef1a9e8` | 별도 로컬 스택 | `20261022132547_email_ingress.sql`과 `20261022133116_email_threads.sql`로 체인이 다시 구축됨; 동기화가 추가 마이그레이션을 생성하지 않음 |
| `supabase test db` | 2026-10-22 | `aef1a9e8` | 별도 로컬 스택 | 파일 7개, pgTAP 테스트 103개 통과, `email_channel.test.sql` 포함 |
| `npm test` | 2026-10-22 | `aef1a9e8` | 로컬 | 테스트 429개 통과(파일 43개) |
| `npm run test:integration` | 2026-10-22 | `aef1a9e8` | 별도 로컬 스택 | 538개 중 535개 통과(파일 52개); 실패 3개는 `email-receiver.test.ts`가 이전 실행의 수신 기록이 남은 데이터베이스에서 고정된 Svix ID를 재사용했기 때문입니다. 고유 ID를 쓰면 이 파일은 통과합니다(테스트 9개) |
| `npm run test:e2e` | 2026-10-22 | `aef1a9e8` | 별도 로컬 스택 | Playwright 테스트 38개 중 37개가 처음에 통과했으며 390 및 1280 픽셀의 `email-link.test.ts`도 포함됩니다; 1280 픽셀의 3단계 요청자 여정은 4단계에 기록된 대로 병렬 실행 중 신원 제목 포커스를 놓쳤고 재시도에서 통과했습니다. 앞선 전체 실행에서는 다른 묶음이 페이지를 컴파일하는 동안 카드가 첫 대기 시간을 더 길게 요구한다는 점과, 공개 페이지의 이메일 줄이 호스트의 핸들 텍스트를 되풀이한다는 점이 드러났고 둘 다 고쳤습니다 |
| `npm run build`, `npm run lint`, `npm run typecheck`, `npm run check` | 2026-10-22 | `aef1a9e8` | 로컬 | 통과; lint는 이 변경 이전부터 있던 경고만 보고함 |

### 항목별 증거

픽스처와 로컬 스택 증거뿐이며, 각 항목은 이를 보여 주는 테스트를 명시합니다.

| 항목 | 증거 |
|---|---|
| 서명되고 중복이 제거된 수신 | `tests/integration/email-receiver.test.ts`: `204` 전에 수신 기록 하나와 작업 하나; 동시 전달 네 건과 응답 유실 후 재시도는 하나로 정리됨; 다른 증거로 재사용된 이벤트, 메시지, 전달은 `409`로 답하고 아무것도 바꾸지 않음; 비활성, 교체됨, 알 수 없음, 키가 바뀐 수신기와 잘못되었거나 오래된 서명은 아무것도 저장하지 않음; 수신 기록에는 본문, 발신자, 제목이 없음. `tests/integration/eve-surface.test.ts`는 빌드된 에이전트 서비스에서 서명되지 않은 경로를 거부함 |
| 이메일로 시작 | `tests/integration/email-journey.test.ts` "is answered in the thread, continues at the booking link in the same session, and hears the decline": 서명된 웹훅이 `eve dev` 채널 경로에 도달하고, 발신자를 확인되지 않은 연락처로 하는 요청과 생성 이메일이 만들어지며, 턴이 eve에서 실행되고, 세션 소유자 훅이 답장을 발송 대상으로 만들며, 답장은 같은 스레드에 그 턴의 텍스트를 담음 |
| AC-05 | 같은 테스트: 이전 메시지의 "option 2"를 고르는 이메일은 합의를 기록하지 않고 두 번째 요청도 만들지 않으며, 답장은 예약 페이지로 안내함 |
| AC-11 | 같은 테스트: 확정 후 예약 페이지 메시지는 이메일 메시지를 처리한 하나의 세션에 도달함. "links a thread and continues the same conversation by email"은 반대 방향을 다루며, 연결 코드는 모델에 도달하지 않음 |
| 발신자 진위와 전달된 링크(D3, D5) | `tests/integration/email-threads.test.ts`(위조, 스팸 라벨, 자체 받은편지함, 복사된 수신자 메시지는 아무것도 전달하지 않음)와 `tests/integration/email-links.test.ts`(전달됨, 인증되지 않음, 스레드 내 코드는 코드를 무효화함) |
| 답장(D8) | `email-threads.test.ts` "retries a lost response with the same key and sends one email", "records uncertain without sending once the retry horizon passed", "records a refusal as rejected", "is refused before any provider call in a preview" |
| 이메일로 계속 | `email-links.test.ts`; 390 및 1280 픽셀에서 키보드로 진행한 `tests/e2e/email-link.test.ts` |
| 스레드 알림 | `tests/integration/email-notices.test.ts` |
| 보존(D4) | `supabase/tests/email_channel.test.sql` |

### 알려진 공백

- **실제 다중 턴 받은편지함 전달**은 허가된 수신자와 함께하는 것이 보류 중입니다: `findmeatime@agentmail.to`는 받은편지함 세 개 한도에 막혀 있고, 등록된 웹훅이 없으며, 마이그레이션이 공유 프로젝트에 없습니다(결정 기록의 "사용자 대기 항목").
- **문서를 근거로 가정한 AgentMail 동작:** `authentication_results`, `extracted_text`, 답장 엔드포인트의 `Idempotency-Key` 의미, Svix 서명은 스탠드인을 상대로만 검증되었습니다.
- **이메일을 통한 실제 모델 답장**은 평가되지 않았으며, 이 여정은 OpenAI 스탠드인을 사용했습니다.
