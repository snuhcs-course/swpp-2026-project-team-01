# 인수 기록

> 한국어 번역본 (검토용). 원본: documentations/technical_specification/07_acceptance_record.md

상태: 1단계(`application-foundation`)와 2단계(`host-onboarding`) 증거 기록됨; 3단계(`requester-intake-and-feasibility`) 릴리스 기록됨, 인수 증거는 보류 중; 4단계(`host-review-and-booking`) 릴리스되고 프로덕션에서 확인됨; 게스트 받은편지함 확인은 보류 중; 5단계(`agent-access`) 로컬 증거 기록됨, 명명된 클라이언트와 프로덕션 증거 보류 중; 6단계(`host-imessage-channel`) 로컬 증거 기록됨, 회선, 기기, 프로덕션 증거 보류 중; 7단계(`requester-email-channel`) 로컬 증거 기록됨, 받은편지함과 프로덕션 증거 보류 중; 8단계(`operations-and-release`) 로컬 증거 기록됨; [릴리스 요약](#release-summary)이 모든 시나리오의 상태를 나열; 열린 공백은 아래에 나열

날짜: 2026-10-23

이 기록은 [구현 계획](06_implementation_plan.md)의 각 단계가 해당 단계의 증거 목록에 맞춰 만들어 낸 증거를 나열합니다. 모든 항목에는 실행한 명령, 날짜, 리비전, 환경이 명시되어 있습니다. 픽스처와 로컬 스택 실행은 로직을 증명할 뿐이며, **production**으로 표시된 항목만 배포된 연동을 증명합니다. 토큰, 시크릿, 이메일 주소, 개인 메시지 본문은 이 기록에 넣지 않습니다.

## 릴리스 요약

2026-10-23에 [`operations-and-release`](../../openspec/changes/operations-and-release/proposal.md) 변경(레인 D)이 아래 각 단계 절을 바탕으로 정리했습니다. **로컬**은 픽스처 또는 로컬 스택 증거로 로직을 증명하며, **프로덕션**은 배포된 연동에 대한 점검을 뜻하고, **보류**는 [PRD](../02_product_requirements.md#9-end-to-end-release-acceptance-scenarios)가 여전히 요구하는 항목입니다. 보류 항목이 하나라도 있는 시나리오는 종료된 것이 아니며, 해결되지 않은 명명된 클라이언트, 기기, 받은편지함 사례는 릴리스 차단 요인이므로 **릴리스는 아직 수용할 수 없습니다**. 무관용 지표(인가되지 않은 예약, 중복 이벤트, 비공개 정보 노출)는 지금까지 실행한 테스트 묶음에서 실패한 사례가 없습니다.

| ID | 로컬 | 프로덕션 | 보류 |
|---|---|---|---|
| AC-01 | 합의까지 `tests/e2e/requester-intake.test.ts`, 이어서 예약된 이벤트 하나까지 `tests/e2e/host-review.test.ts` ([4단계](#phase-4--host-review-and-booking)) | 2026-10-22의 웹 예약: 호스트의 실제 Google Calendar에 이벤트 하나 ([4단계 프로덕션 점검](#production-acceptance-check)) | 게스트의 받은편지함; 같은 여정을 이메일, iMessage, 각 명명된 클라이언트로 수행 |
| AC-02 | `tests/integration/evaluation.test.ts` "checks the host's inbound trip through Routes and reuses the estimate within 24 hours"와 "leaves a leg with no route unresolved and out of the requester's list"; `host-requests.test.ts` 수동 허용; `bookings.test.ts` "stops at revalidation when a busy event appeared" | — | 실제 Routes 점검(3단계 작업 5.2)과 프로덕션 실행 |
| AC-03 | `tests/integration/host-requests.test.ts` ([4단계](#phase-4--host-review-and-booking)) | 4단계 프로덕션 점검의 주간 한도 보류와 **Allow this request beyond my weekly limit** | 웹 경로는 없음; 다른 채널은 AC-14와 AC-16과 같음 |
| AC-04 | `host-requests.test.ts` "shares a feasible later time as a checked new version" | — | 프로덕션 실행 |
| AC-05 | `tests/integration/email-journey.test.ts` ([7단계](#phase-7--requester-email-channel)) | — | 실제 받은편지함 전달: AgentMail 받은편지함이 차단됨 |
| AC-06 | `bookings.test.ts`(웹), `imessage-commands.test.ts`(iMessage와 웹), `agent-join.test.ts`(에이전트) | — | 프로덕션 실행; 명명된 클라이언트 |
| AC-07 | `bookings.test.ts` "stops at revalidation when a busy event appeared"와 "dispatches only one of two competing bookings for the same host" | — | 프로덕션 실행 |
| AC-08 | `bookings.test.ts` 유실된 응답 조정; `tests/integration/recovery-operations.test.ts`는 운영자가 찾은 불확실한 예약을 조정 | — | Google을 상대로 안전하게 유발할 수 있는 것은 없음; 픽스처 증거로 갈음 |
| AC-09 | `bookings.test.ts` 거부된 쓰기와 취소된 접근; `booking-emails.test.ts` 반송된 사본 | — | 취소된 접근의 프로덕션 실행 |
| AC-10 | `tests/integration/host-review.test.ts`; `agent-mcp-host.test.ts`(OAuth 부여로는 아무것도 예약되지 않음) | — | 명명된 클라이언트 |
| AC-11 | `email-journey.test.ts`, `email-links.test.ts` ([7단계](#phase-7--requester-email-channel)) | — | 실제 받은편지함 전달 |
| AC-12 | `lib/server/feasibility.test.ts` "yields nothing for a window whose end is ambiguous or does not exist"; `tests/integration/request-reviews.test.ts` "asks the authored Korean question for an ambiguous local time and records no window" | — | 서머타임 변경 구간에 걸친 프로덕션 실행 |
| AC-13 | `bookings.test.ts` 발송 전후의 철회, 거절, 만료 | — | 프로덕션 실행 |
| AC-14 | `tests/integration/agent-join.test.ts`, 스크립트 방식 ([5단계](#phase-5--agent-access)) | — | Dots, Muse, Instinct, ChatGPT, Codex, Claude, Claude Code, 각각 두 역할 모두 |
| AC-15 | `agent-mcp-requester.test.ts`, 스크립트 방식 | — | 명명된 클라이언트 일곱 개 |
| AC-16 | `eve dev`를 통한 `tests/integration/imessage-journey.test.ts` ([6단계](#phase-6--host-imessage-channel)) | — | Photon 회선, 그 웹훅, 통제된 iPhone |
| AC-17 | `imessage-journey.test.ts`, `imessage-channel.test.ts`, `imessage-commands.test.ts` | — | 통제된 iPhone |
| AC-18 | `imessage-journey.test.ts`, `imessage-commands.test.ts`, `imessage-notices.test.ts` | — | 서비스 재시작을 포함한 통제된 iPhone |
| AC-19 | `tests/e2e/agent-connect.test.ts`; `agent-mcp-host.test.ts` | — | 명명된 클라이언트; 프로덕션 서명 키 |
| AC-20 | `lib/server/agent-tokens.test.ts`; `agent-mcp-host.test.ts` | — | 명명된 클라이언트 |
| AC-21 | `agent-mcp-requester.test.ts`; `agent-mcp-host.test.ts` | — | 명명된 클라이언트 |
| AC-22 | `tests/integration/agent-cli.test.ts`; 합류 테스트 | — | 프로덕션을 상대로 한 CLI |
| AC-23 | `lib/server/entry-documents.test.ts`, `tests/integration/entry-documents.test.ts`, 문서만 | 두 오리진 모두에서 `/SKILL.md` 제공(2단계) | 각 명명된 클라이언트가 일반 URL과 `/SKILL.md` URL을 붙여 넣기 |
| AC-24 | 같은 문서 테스트 | `/{handle}/SKILL.md` 제공(3단계 스모크 테스트) | 각 명명된 클라이언트 |
| AC-25 | 같은 문서 테스트; `agent-mcp-requester.test.ts` "refuses a resource for an unknown host" | — | 각 명명된 클라이언트와 거부된 동의 |
| AC-26 | `tests/integration/host-admission.test.ts`, `setup-tools.test.ts`, `entry-documents.test.ts`, `operator.test.ts` ([1단계](#phase-1--application-foundation), [2단계](#phase-2--host-onboarding)) | `https://findmeatime.com`에서의 실제 로그인 1회로 호스트 계정 하나 생성(1단계) | 설정 전 MCP와 CLI를 통한 게시 시도; 프로덕션에서의 정지 |
| AC-27 | `tests/integration/requester-google.test.ts`; `evaluation.test.ts` "uses the requester's busy time without storing or showing their events" | — | 실제 요청자 동의, Google 앱이 **Testing** 상태인 동안 차단됨 |
| AC-28 | 항목별 [2단계](#phase-2--host-onboarding) 증거 | — | 프로덕션에서 로그인한 설정; Google 앱 검증 |

앞서 기록된 두 공백이 해당 단계가 기록된 이후 바뀌었습니다. 6단계까지의 모든 마이그레이션이 이제 공유 프로젝트에 있으며(2026-10-23에 확인), 현재 프로덕션 배포(2026-10-23 07:02 KST)는 6단계 병합보다 앞서므로 6~8단계는 배포되지 않았습니다.

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

변경: [`host-review-and-booking`](../../openspec/changes/host-review-and-booking/tasks.md). 증거 목록: [4단계](06_implementation_plan.md#phase-4--host-review-and-booking). 환경은 1단계와 같으며, 로컬 Google 대역은 `events.insert`와 `events.get`(고정 이벤트 ID, 중복 시 `409`, 생성 전후의 응답 유실)으로 확장되고 로컬 Cloudflare 대역은 `reply_to`와 첨부 파일을 기록합니다. 프로덕션에서 실행된 것은 아래의 릴리스 절차뿐입니다.

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

### 프로덕션 배포

2026-10-22에 구현 세션이 사용자의 요청으로 **production** 배포 `findmeatime-release`를 대상으로 실행했습니다.

| 절차 | 리비전과 배포 | 명령 | 결과 |
|---|---|---|---|
| 푸시 전 공유 프로젝트 | `708381cb` | `supabase migration list --linked` 후 `supabase db push --linked --dry-run` | 1~3단계 마이그레이션 21개가 적용됨; `20261022021159_host_review_and_booking.sql`만 나열됨 |
| 마이그레이션 | `708381cb` | `supabase db push --linked`, `supabase migration list --linked` | 적용됨; 22개가 나열되고 대기 중인 것은 없음 |
| PR #30 병합(관리자 우회) | `708381cb` | `gh pr merge 30 --squash --admin` | CI 7개 중 7개가 통과한 뒤 병합됨 |
| 배포 | `708381cb`, `dpl_7LXD9swHWQEXkBHC8LtX7adjMte3` | `origin/main`의 깨끗한 체크아웃에서 `vercel deploy --prod` | Ready; `findmeatime.com`과 `release.findmeatime.com`에 별칭 지정됨 |
| 스모크 테스트 | `708381cb` | `/`, `/app`, `/app?view=requests`, `release.findmeatime.com/SKILL.md`, 알 수 없는 `/booking/{uuid}`, 로그아웃 상태의 `/api/host/requests`의 `curl` | 각 페이지 200; 호스트 요청 API는 세션이 없으면 401로 답함 |

### 프로덕션 인수 확인

2026-10-22에 구현 세션이 사용자의 요청으로 내장 브라우저에서 `https://findmeatime.com`(`708381cb`)을 대상으로 실행했습니다: 호스트 Dodo Park(`/dodo41142727`)는 사용자가 로그인했고, 게스트 주소 `dodo4114@snu.ac.kr`은 팀원 본인의 받은편지함으로 사용자가 알려 주었습니다. 요청 `70de0d77-e596-4428-a3d7-c2cf769a486e`.

| 절차 | 결과 |
|---|---|
| `/dodo41142727`의 게스트 스레드 | 첫 메시지가 초안을 시작했고, 어시스턴트가 세부 정보를 작성한 뒤 신원 카드를 호출했으며, **Continue without Google**(Google 없이 계속)로 게스트가 식별되자 주소 표시줄이 제자리에서 예약 링크로 바뀌고 생성 이메일이 기록됨 |
| 10월 27일 화요일 14:00–17:00 | 시간 없음: 호스트의 화요일 시간(10:00–14:00) 밖이며, 게스트에게 작성된 일치 없음 메시지가 표시됨 |
| 10월 26일 월요일 15:00–17:00, 10월 29일 목요일 14:00–22:00 | 시간 없음: 모든 슬롯이 10월 12일부터 11월 2일까지 이어지는 호스트 기본 캘린더의 종일 이벤트와 겹치며, 합의된 규칙에 따라 바쁨으로 계산됨; 호스트의 비공개 화면에는 이유가 표시되었고 게스트 화면에는 표시되지 않음. 게스트 대화의 두 번째 턴은 초안 작성 없이 `read_request` 뒤에 끝나서 창은 **Edit details**(세부 정보 편집)로 설정함 |
| 11월 2일 월요일 10:00–13:00 | 가능한 슬롯 하나가 있었으나, 그 주에 이미 호스트의 한도인 6회 회의가 있어(D8) 게스트에게는 제시되지 않음; 호스트의 규칙 및 이동 검토에 보류가 표시됨 |
| **Allow this request beyond my weekly limit**(이 요청은 주간 한도를 넘어 허용) | 이후 호스트의 평가가 게스트에게 11월 2일 월요일 10:00을 제시함 |
| **Choose this time**(이 시간 선택), **Agree to this proposal**(이 제안에 동의) | 버전 1에 합의됨; 게스트에게 "Waiting for Dodo Park to approve"(Dodo Park의 승인을 기다리는 중)가 표시됨 |
| `/app?request=…`에서 **Approve this proposal**(이 제안 승인) | 약 20초 안에 예약됨; 호스트 영수증에 Google이 알려 준 주최자, 게스트, **Join meeting**(회의 참여), **Open in Google Calendar**(Google Calendar에서 열기)가 표시됨 |
| 호스트의 Google Calendar | `dodo41142727@gmail.com`의 이벤트 `cd6da3e53fca4f558834313ac1bcf740`(예약 ID의 16진수), Asia/Seoul 10:00–10:30, 유일한 참석자는 게스트, Google Meet 링크, 예약 링크가 없는 설명 |
| 게스트의 예약 링크 | "Your meeting is booked"(회의가 예약되었습니다)와 영수증만 표시되며, **Join meeting**이 있고 캘린더 링크는 없음 |
| 호스트의 확인 메일 | 호스트의 Gmail로 전달됨: 제목 "Review the Phase 4 booking flow between Dodo Park and Dohyeon Park", Asia/Seoul 기준 네 블록, 예약 링크 없이 `/app?request=…`로 가는 **View booking**(예약 보기), **Join meeting**, `text/calendar` 첨부 파일 `invite.ics` |

발견: Google이 주최자 이름을 돌려주지 않으면 영수증이 주최자를 "address <address>"로 표시합니다; 후속 풀 리퀘스트에서 수정됩니다.

### 알려진 공백

- **게스트 받은편지함.** `dodo4114@snu.ac.kr`에 도착한 게스트의 확인 사본과 Google 자체 초대는 세션이 읽지 않았으며, 팀원이 확인합니다.
- **Outlook.** `text/calendar` 첨부 파일은 Gmail에 도착했으며, Outlook은 확인하지 않았습니다.
- **알림**은 D3에 따라 미뤄졌습니다.

## 5단계 — `agent-access`

변경: [`agent-access`](../../openspec/changes/agent-access/tasks.md). 증거 목록: [5단계](06_implementation_plan.md#phase-5--agent-access). 환경은 1단계와 같습니다. 일반 `fetch`로 만든 스크립트된 MCP 클라이언트와 CLI `fmat`이 에이전트를 대신하며, 명명된 클라이언트는 실행되지 않았고 여기의 어느 것도 프로덕션에서 실행되지 않았습니다. 클라이언트별 결과는 [개인 에이전트 클라이언트](09_agent_clients.md)에 속합니다.

### 테스트 묶음 실행

| 명령 | 날짜 | 리비전 | 환경 | 결과 |
|---|---|---|---|---|
| `supabase db reset --local` 후 `supabase test db` | 2026-10-22 | `dada09ac` | 로컬 스택 | `20261022132708_agent_access.sql`로 체인이 다시 구축됨; 파일 7개, pgTAP 테스트 100개 통과, `agent_access.test.sql` 포함 |
| `npm test` | 2026-10-22 | `15a1e43e` | 로컬 스택 | 파일 44개, 테스트 421개 통과 |
| `npm run test:integration` | 2026-10-22 | `15a1e43e`와 합류 테스트 | 로컬 스택 | 파일 52개, 테스트 538개 통과 |
| `npm run build`, `npm run lint`, `npm run typecheck`, `npm run check` | 2026-10-22 | `15a1e43e` | 로컬 스택 | 모두 종료 코드 0; 린트는 이미 `main`에 있던 경고 세 개만 보고함 |
| `npm run test:e2e` | 2026-10-23 | `15a1e43e`와 합류 커밋의 테스트 변경 | 로컬 스택 | 기본 워커로, 기기의 다른 작업 때문에 부하 평균이 68 가까운 상태에서 24개 통과, 10개는 재시도에서 통과, 5개는 시간 초과로 실패; 5개는 `--last-failed --workers=2`로 다시 실행하자 통과했고, `--workers=2`로 전체를 다시 실행하자 39개 모두 통과 |

### 항목별 증거

로컬 증거뿐이며, 각 항목은 이를 보여 주는 테스트를 명시합니다.

| 항목 | 증거 |
|---|---|
| AC-14, 스크립트 | `tests/integration/agent-join.test.ts`: 한 요청에서 요청자 MCP 클라이언트와 호스트의 CLI가 같은 상태와 제안 버전을 보고, 재시도한 동의는 재생되며, 호스트 결정 도구는 아무것도 예약하지 않고, 호스트가 직접 두 번 한 승인은 이벤트 하나만 예약하며, 철회되면 양쪽 모두 접근을 잃음 |
| AC-15, 스크립트 | `tests/integration/agent-mcp-requester.test.ts` "creates exactly one request, emails its link, and binds the grant to it"와 "finds times, refuses a stale version and agrees to the current one"; 합류 테스트는 호스트가 승인한 뒤 예약된 영수증을 읽음 |
| AC-19 | 390 및 1280 픽셀의 `tests/e2e/agent-connect.test.ts`: 좁혀진 동의, 에이전트의 코드, **Connected agents**와 **Revoke**; "a denied connection returns access_denied and connects nothing"; `tests/integration/agent-mcp-host.test.ts` "lists only the tools the permissions allow and challenges a missing one" |
| AC-20 | `lib/server/agent-tokens.test.ts`(틀린 키, 발급자, 대상, 유형, 만료, 바뀐 클레임, `alg: none`, 토큰이 제공한 키); `agent-mcp-host.test.ts` "challenges a missing, foreign or wrong-audience token"과 "prepares a decision only for the current version and never approves" |
| AC-21 | `agent-mcp-requester.test.ts`: 다른 호스트의 예약 링크는 동의에서 거절되고, 바인딩된 허가는 자기 요청에만 닿으며, 바인딩되지 않은 허가는 24시간 뒤 만료됨; `agent-mcp-host.test.ts` "reads only the host's own requests in the host projection" |
| AC-22 | `tests/integration/agent-cli.test.ts`: 헤드리스 로그인, JSON 출력, 출력된 키로 한 정확한 재시도, 충돌하는 재사용, 새 로그인을 요구하는 거절된 갱신; 합류 테스트는 한 요청에서 MCP와 CLI를 사용함 |
| AC-23 ~ AC-25, 문서만 | 지침 버전 3에 대한 `lib/server/entry-documents.test.ts`와 `tests/integration/entry-documents.test.ts`; `agent-mcp-requester.test.ts` "refuses a resource for an unknown host" |
| 인증 서버 | `tests/integration/agent-authorization.test.ts`(19개): 디스커버리, 등록과 그 한도, 검증 순서, 메타데이터 문서, 동의와 로그인 복귀, 동시 및 재생된 코드, 리프레시 회전과 재생, 없는 서명 키, 철회와 정지 |

### 알려진 공백

- **명명된 클라이언트.** Dots, Muse, Instinct, ChatGPT, Codex, Claude, Claude Code는 어느 역할로도 실행되지 않았습니다. [개인 에이전트 클라이언트](09_agent_clients.md)에 기록되기 전까지 AC-14, AC-15, AC-19 ~ AC-25는 각 클라이언트에 대해 열려 있습니다. 해결되지 않은 클라이언트는 릴리스 차단 요인입니다.
- **프로덕션.** 마이그레이션, 서명 키, 배포가 보류 중입니다(결정 기록의 "사용자 대기 항목").
- **CLI의 시스템 저장소.** macOS 키체인과 Secret Service 경로는 파일 저장소를 쓰는 테스트 묶음에서 실행되지 않았습니다.

## 6단계 — `host-imessage-channel`

변경: [`host-imessage-channel`](../../openspec/changes/host-imessage-channel/tasks.md). 증거 목록: [6단계](06_implementation_plan.md#phase-6--host-imessage-channel). 환경은 기본 로컬 스택을 쓰는 1단계와 같고, 여기에 전송을 기록하고 전송을 거부하거나 응답을 버릴 수 있는 루프백 Photon 스탠드인(`tests/integration/support/fake-photon.ts`, 브라우저 테스트용은 `tests/e2e/support/fake-photon-server.ts`)이 더해졌습니다. 수신 메시지는 Photon의 문서화된 방식(`tests/integration/support/photon.ts`)으로 서명했습니다. Photon 회선은 존재하지 않고, 등록된 웹훅도 없으며, Photon, 실제 휴대폰, 프로덕션을 상대로 실행된 것은 없습니다.

### 테스트 묶음 실행

| 명령 | 날짜 | 리비전 | 환경 | 결과 |
|---|---|---|---|---|
| `supabase db reset --local` 후 선언적 동기화 | 2026-10-23 | `b2f6fe95` | 로컬 스택 | `20261023024435_imessage_channel.sql`로 체인이 다시 구축됨 |
| `supabase test db` | 2026-10-23 | `708ac2f2` | 로컬 스택, 초기화 후 | 파일 9개, pgTAP 테스트 127개 통과, `imessage_channel.test.sql` 포함. 초기화 없이 실행하면 `agent_access.test.sql`만 실패했는데, 통합 테스트 실행이 막 남겨 둔 `fmat-cli` 클라이언트를 이 테스트가 삽입하기 때문입니다 |
| `npm test` | 2026-10-23 | `708ac2f2` | 로컬 | 테스트 470개 통과(파일 51개) |
| `npm run test:integration` | 2026-10-23 | `708ac2f2` | 로컬 스택 | 648개 중 647개 통과(파일 66개). 실패한 `conversations.test.ts` "lets only one of two concurrent deliveries reconcile an overdue turn"은 이 변경이 건드리지 않는 `eve dev`의 타이밍 검사이며, 단독으로 다시 실행하면 통과했습니다(19개 중 19개) |
| `npm run test:e2e` | 2026-10-23 | `65b0dff0` | 로컬 스택 | Playwright 테스트 46개 통과, 45개는 처음에, 1개는 재시도에서 통과(1280px의 3단계 요청자 여정, 포커스 대기). 앞선 전체 실행에서 설정 로딩이 끝나면 Connect iMessage 카드가 다시 마운트되어 상태를 잃는 문제와, 테스트가 버튼에 포커스를 둔 뒤 메뉴가 포커스를 옮기는 문제가 발견되어 둘 다 수정했습니다 |
| `npm run build`, `npm run lint`, `npm run typecheck`, `npm run check` | 2026-10-23 | `65b0dff0` | 로컬 | 통과; lint는 이 변경 이전부터 있던 경고만 보고함 |
| 독립 검토의 수정 이후: iMessage, 에이전트 표면, 예약, 작업 처리기 통합 스위트; `supabase test db`; `npm test`; `npm run lint`; `npm run typecheck`; 재시도 없이 두 번 실행한 `tests/e2e/imessage-link.test.ts` | 2026-10-23 | 검토 수정 커밋 | 로컬 스택 | 통합 테스트 122개(파일 12개), pgTAP 테스트 127개, 단위 테스트 470개, 브라우저 테스트 4개 중 4개 통과. 수정 뒤 시작한 전체 브라우저 실행은 기기의 디스크가 가득 차(`ENOSPC`) Docker가 멈추면서 중단됐고, 디스크가 다시 차지 않도록 반복하지 않았습니다 |

### 항목별 증거

픽스처와 로컬 스택 증거뿐이며, 각 항목은 이를 보여 주는 테스트를 명시합니다.

| 항목 | 증거 |
|---|---|
| 스파이크와 어댑터(D1, D2) | [설계 1](../../openspec/changes/host-imessage-channel/design.md#1-the-transport-spike-and-the-adapter)이 비교를 기록하며, `lib/server/photon-receiver.test.ts`가 서명 방식, 발신자 식별자 형식, 페이로드를 다룹니다 |
| 내구성 있는 서명 영수증 | `tests/integration/imessage-receiver.test.ts`: `200` 이전에 봉인된 영수증 하나와 작업 하나; 동시 전달과 반복 전달은 하나로 귀결; 페이로드가 바뀌면 `409`로 응답; 오래되었거나, 서명이 잘못되었거나, 다른 웹훅이거나, 구성되지 않았거나, 너무 큰 전달은 아무것도 저장하지 않음. `tests/integration/eve-surface.test.ts`는 빌드된 에이전트 서비스에서 서명되지 않은 라우트를 거부함 |
| 연결(D3, D5) | `tests/integration/imessage-links.test.ts`: **Confirm and link** 이후에만 바인딩; 알 수 없거나 만료되었거나 재사용되었거나 그룹에서 온 코드는 아무것도 바인딩하지 않음; 하루 한 번의 거절; 하나의 호스트에만 바인딩되는 발신자; 확인 창; 시간당 코드 5개와 정확한 재시도 |
| 원탭 딥링크(D4) | `lib/contracts/imessage.test.ts`(플랫폼, `&body=`와 `?body=`, QR 코드의 링크); 390px 및 1280px의 `tests/e2e/imessage-link.test.ts`(데스크톱은 번호, 메시지, **Copy**, QR 코드를 보여 주고 아무것도 열지 않음)와 iPhone 사용자 에이전트(카드의 **Open Messages**가 정확한 iOS 링크를 담음) |
| 대체 코드(D6) | `imessage-links.test.ts`(코드가 브라우저에 도달하지 않음, 간격, 재전송, 잘못된 입력 5회, 호스트별 및 회선별 한도, 다른 곳에 연결된 번호); 390px Playwright 여정은 문자로 받은 코드를 다시 입력함 |
| 발신함(D9) | `tests/integration/imessage-outbox.test.ts`: 한 번 수락됨, 거부됨, 도달 불가 후 실패, 응답이 유실되어 불확실하며 다시 보내지 않음, 연결 해제 후 억제됨, 미리보기에서는 아무것도 없음; 전송과 게이트는 `lib/server/photon.test.ts` |
| AC-16 | `tests/integration/imessage-journey.test.ts` "links, discusses, revises, approves and books from iMessage, and declines another request", OpenAI 스탠드인을 둔 `eve dev`를 통해: 에이전트 서비스의 웹훅 라우트로 코드 연결, 정확한 명령이 담긴 승인 대기 요약, `request <ref>`, iMessage의 턴이 답하는 비공개 질문, `changes`와 `share <ref>-S1`, 요청자의 버전 2 동의, `approve <ref>-2`, 확정된 예약. 스탠드인 모델은 도구를 호출할 수 없으므로 수정은 `propose_shared_changes`가 실행하는 명령으로 기록했습니다. 별도의 거절 사례는 이벤트를 만들지 않습니다 |
| AC-17 | 같은 여정: 평범한 "yes"와 오래된 `approve <ref>-1`은 아무것도 기록하지 않음; "gives an unlinked sender and a group conversation nothing private"; `tests/integration/imessage-channel.test.ts`(연결되지 않았거나 정지된 발신자, 그룹 대화, 반응)와 `imessage-commands.test.ts`(오래되었거나 알 수 없는 참조) |
| AC-18 | 여정과 `imessage-commands.test.ts` "approves the current proposal once, also when replayed and after a web approval": 같은 메시지를 두 번 전달해도 영수증은 하나이고, 재시작 때처럼 다시 처리한 영수증은 저장된 승인을 재생하며, 동시에 일어난 웹 승인은 예약을 하나만 남김; 예약 완료 요약의 전달이 거부되면 요청은 예약된 채로 `/app` 카드에 표시됨(`imessage-notices.test.ts`도 해당) |
| 배압 | `imessage-forwarding.test.ts` "defers a message an admission budget refuses by at least a minute, keeping later ones behind it"; `imessage-channel.test.ts`는 처리되지 않은 앞선 메시지 뒤에 나중 메시지를 유지함 |
| 요약(D12) | `tests/integration/imessage-notices.test.ts`: 새 요청, 승인 대기(명령과 함께 한 번), 확정, 확정되지 않음, 여전히 대기 중; 바인딩이 없으면 없음; 오래된 버전은 건너뜀 |
| iMessage를 통한 설정 | `tests/integration/imessage-setup.test.ts`와 `imessage-commands.test.ts` "reviews settings with their reference and saves them only for the current one" |
| 보존(D14) | `supabase/tests/imessage_channel.test.sql`; `imessage-setup.test.ts` "retention" |

| 검토 수정 | `imessage-forwarding.test.ts` "sends a turn reply frozen by an attempt that found Photon unavailable"; `imessage-links.test.ts`(그룹에 올린 코드는 그 시도를 무효로 함; 두 번 탭해도 도착은 한 번; 다른 곳에 연결된 번호는 기록되고 전송됨으로 표시; 연락처 카드는 최종 결과 뒤 다시 공유 가능; 처리 중인 메시지가 있으면 연결 해제가 기다림); `imessage-channel.test.ts`(나중 메시지는 새 작업에서 기다리다 앞당겨짐); `imessage-commands.test.ts`(요청이 넘어간 뒤에도 재시도된 승인은 저장된 결과로 응답함) |
### 알려진 공백

- **실제 회선, 웹훅, 기기 실행 없음:** Photon 회선 프로비저닝, 웹훅 등록, 그리고 통제된 iPhone에서의 모든 확인(iOS Safari에서 기다린 요청 이후 딥링크가 메시지 앱을 여는지, 데스크톱의 QR 코드, 실제 iPhone이 보내는 발신자 식별자, 프로덕션에 대한 AC-16부터 AC-18, 기기와 클라이언트 버전)이 보류 중입니다(결정 기록의 "사용자 대기 항목").
- **SDK에서 가정한 Spectrum 전송 경로:** `space.get`, `space.create`, `send`, `shareContactCard`는 `@spectrum-ts` 12.14.0에 맞춰 타입이 지정되었고 스탠드인을 통해서만 실행되었습니다.
- **iMessage를 통한 실제 모델 응답**은 평가하지 않았으며, 여정에는 OpenAI 스탠드인을 썼습니다.
- **프로덕션 배포.** 마이그레이션은 이것만 나열한 드라이 런 뒤 2026-10-23에 `873804b`에서 `supabase db push --linked`로 공유 프로젝트에 적용했으며, 이후 드라이 런은 원격 데이터베이스가 최신이라고 보고했습니다. `findmeatime-release`는 6단계로 다시 배포되지 않았습니다.

## 7단계 — `requester-email-channel`

변경: [`requester-email-channel`](../../openspec/changes/requester-email-channel/tasks.md). 증거 목록: [7단계](06_implementation_plan.md#phase-7--requester-email-channel). 환경은 1단계와 같으나, 병렬로 진행된 5단계 세션의 스택을 초기화하지 않도록 로컬 스택은 별도의 것(`project_id` `fmat-phase7`, 포트 553xx)이었고([결정 기록](08_decision_log.md#phase-7--requester-email-channel)), 로컬 AgentMail 스탠드인(`tests/integration/support/fake-agentmail.ts`)이 메시지 API를 제공하고 답장을 기록하며 `Idempotency-Key`를 따랐습니다. 받은편지함은 존재하지 않으며 AgentMail이나 프로덕션을 상대로 실행된 것은 없습니다.

### 테스트 묶음 실행

| 명령 | 날짜 | 리비전 | 환경 | 결과 |
|---|---|---|---|---|
| `supabase db reset --local` 후 선언적 동기화 | 2026-10-23 | `ea295024` | 별도 로컬 스택 | `20261023010000_email_ingress.sql`, `20261023010100_email_threads.sql`, `20261023010200_email_review_fixes.sql`로 체인이 다시 구축됨 |
| `supabase test db` | 2026-10-23 | `ea295024` | 별도 로컬 스택 | 파일 7개, pgTAP 테스트 106개 통과, `email_channel.test.sql` 포함 |
| `npm test` | 2026-10-23 | `ea295024` | 로컬 | 테스트 429개 통과(파일 43개) |
| `npm run test:integration` | 2026-10-23 | `ea295024` | 별도 로컬 스택 | 검토 수정 이후 테스트 547개 통과(파일 52개). `aef1a9e8`의 앞선 실행에서는 538개 중 535개가 통과했으며, 실패 3개는 `email-receiver.test.ts`가 실행 사이에 유지된 데이터베이스에서 고정된 Svix ID를 재사용했기 때문이고 이후 고쳤습니다 |
| `npm run test:e2e` | 2026-10-23 | `ea295024` | 별도 로컬 스택 | Playwright 테스트 38개 통과, 34개는 처음에, 4개는 병렬 실행 중 재시도에서 통과했습니다(호스트 설정 2회, 390 픽셀의 워크스페이스, 390 픽셀의 3단계 요청자 여정); 이메일 테스트는 하나도 없습니다. `aef1a9e8`에서는 38개 중 37개가 처음에 통과했습니다. 앞선 전체 실행에서는 다른 묶음이 페이지를 컴파일하는 동안 카드가 첫 대기 시간을 더 길게 요구한다는 점과, 공개 페이지의 이메일 줄이 호스트의 핸들 텍스트를 되풀이한다는 점이 드러났고 둘 다 고쳤습니다 |
| `npm run build`, `npm run lint`, `npm run typecheck`, `npm run check` | 2026-10-23 | `ea295024` | 로컬 | 통과; lint는 이 변경 이전부터 있던 경고만 보고함 |

### 항목별 증거

픽스처와 로컬 스택 증거뿐이며, 각 항목은 이를 보여 주는 테스트를 명시합니다.

| 항목 | 증거 |
|---|---|
| 서명되고 중복이 제거된 수신 | `tests/integration/email-receiver.test.ts`: `204` 전에 수신 기록 하나와 작업 하나; 동시 전달 네 건과 응답 유실 후 재시도는 하나로 정리됨; 다른 증거로 재사용된 이벤트, 메시지, 전달은 `409`로 답하고 아무것도 바꾸지 않음; 비활성, 교체됨, 알 수 없음, 키가 바뀐 수신기와 잘못되었거나 오래된 서명은 아무것도 저장하지 않음; 수신 기록에는 본문, 발신자, 제목이 없음. `tests/integration/eve-surface.test.ts`는 빌드된 에이전트 서비스에서 서명되지 않은 경로를 거부함 |
| 이메일로 시작 | `tests/integration/email-journey.test.ts` "is answered in the thread, continues at the booking link in the same session, and hears the decline": 서명된 웹훅이 `eve dev` 채널 경로에 도달하고, 발신자를 확인되지 않은 연락처로 하는 요청과 생성 이메일이 만들어지며, 턴이 eve에서 실행되고, 세션 소유자 훅이 답장을 발송 대상으로 만들며, 답장은 같은 스레드에 그 턴의 텍스트를 담음 |
| AC-05 | 같은 테스트: 이전 메시지의 "option 2"를 고르는 이메일은 합의를 기록하지 않고 두 번째 요청도 만들지 않으며, 답장은 예약 페이지로 안내함 |
| AC-11 | 같은 테스트: 확정 후 예약 페이지 메시지는 이메일 메시지를 처리한 하나의 세션에 도달함. "links a thread and continues the same conversation by email"은 반대 방향을 다루며, 연결 코드는 모델에 도달하지 않음 |
| 발신자 진위와 전달된 링크(D3, D5) | `tests/integration/email-threads.test.ts`(위조, 스팸 라벨, 자체 받은편지함, 복사된 수신자 메시지는 아무것도 전달하지 않음)와 `tests/integration/email-links.test.ts`(전달됨, 인증되지 않음, 스레드 내 코드는 코드를 무효화함) |
| 검토 수정 | `email-links.test.ts` "forwards later replies whose subject or quoted text repeats the code, with the code removed"; `email-threads.test.ts` "holds a reply that arrives before its thread's first message is processed", "answers a started thread once when its first message could not be processed", "sends the fallback when the session failed for good, and redacts the turn's text", "ignores auto-replies and bulk mail"; `email-notices.test.ts` "keeps the booking link sealed while a notice may be sent again" |
| 답장(D8) | `email-threads.test.ts` "retries a lost response with the same key and sends one email", "records uncertain without sending once the retry horizon passed", "records a refusal as rejected", "is refused before any provider call in a preview" |
| 이메일로 계속 | `email-links.test.ts`; 390 및 1280 픽셀에서 키보드로 진행한 `tests/e2e/email-link.test.ts` |
| 스레드 알림 | `tests/integration/email-notices.test.ts` |
| 보존(D4) | `supabase/tests/email_channel.test.sql` |

### 알려진 공백

- **실제 다중 턴 받은편지함 전달**은 허가된 수신자와 함께하는 것이 보류 중입니다: `findmeatime@agentmail.to`는 받은편지함 세 개 한도에 막혀 있고, 등록된 웹훅이 없으며, 마이그레이션이 공유 프로젝트에 없습니다(결정 기록의 "사용자 대기 항목").
- **문서를 근거로 가정한 AgentMail 동작:** `authentication_results`, `extracted_text`, 답장 엔드포인트의 `Idempotency-Key` 의미, Svix 서명은 스탠드인을 상대로만 검증되었습니다.
- **이메일을 통한 실제 모델 답장**은 평가되지 않았으며, 이 여정은 OpenAI 스탠드인을 사용했습니다.

## 8단계 — `operations-and-release`

변경: [`operations-and-release`](../../openspec/changes/operations-and-release/tasks.md). 증거 목록: [8단계](06_implementation_plan.md#phase-8--operations-and-release). 환경은 1단계와 같으며, 이 브랜치는 기본 로컬 스택에서 자체 마이그레이션 체인으로 초기화한 뒤 실행되었습니다.

### 항목별 증거

| 항목 | 증거 |
|---|---|
| 진단 스냅샷과 거부 횟수 | `tests/integration/diagnostics.test.ts`: 고정된 순서의 범주 열 개와 측정되지 않은 범위; 모든 일치 항목에 대한 횟수와 오래된 것부터, 제한되고, 반복 가능한 표본; 출력에 페이로드, 결과, 종류, 실패 문구가 없음; 불확실한 예약과 이메일은 바뀌지 않은 채 보고됨; 만료된 임대는 그대로 남음; Data API 역할은 거부됨; 인식된 명령 거부는 활성화된 동안에만 집계됨; 수집이 실패하거나 멈추면 원래의 거부가 유지됨; 동시 증가 40건; 정리와 포화. 단위 테스트는 `lib/server/diagnostics.test.ts`와 `lib/server/diagnostics-admin.test.ts` |
| 복구 | `tests/integration/recovery-operations.test.ts`: 재큐된 소진 작업은 완료되고 오래된 점유는 차단됨; 소진되지 않은 작업과 알 수 없는 작업은 거부됨; `--yes`나 입력된 ID 없이는 변경 없음; 쓰기가 유실된 예약은 기존 이벤트로 조정되며 가짜 Google Calendar에는 이벤트가 하나; 라이브 작업이 있거나 발송 중이 아닌 예약은 거부되며, 조정이 라이브인 동안 오래된 예약 작업을 재큐하는 것도 거부됨; Data API 역할은 거부됨; 복구마다 감사 행 |
| 백업 복원 | 2026-10-23 `d6e470fa`에서 로컬 스택으로 실행한 `npm run restore:drill`: `pg_dump --format=custom`과 `pg_restore`로 `fmat_drill_restored`에 복원한 뒤 테이블 85개와 합성 행 415개가 동일하게 비교됨; 마이그레이션 이력은 양쪽 모두 `20261023063140`까지 29개 기록; 유효하지 않은 제약 조건 0개; 복원본에서 진단 스냅샷이 실행됨; 로컬 데이터베이스는 변하지 않음. `tests/integration/restore-drill.test.ts`가 훈련을 반복하고 비교가 바뀐 테이블을 지목함을 보여 줌 |

| 보존 | `tests/integration/data-stewardship.test.ts`: 종료 91일 뒤의 예약된 요청은 제안, 예약, 예약 링크, 전달, 논의, 세션, 이벤트와 함께 삭제되고 모델 지출은 분리되며 Calendar 이벤트는 유지됨; 89일 전에 종료된 요청과 200일 된 열린 요청은 유지됨; 운영 규칙마다 각자의 기간; 실행당 규칙별 행 제한; 매시간 일정 |
| 요청에 따른 삭제 | 같은 파일: 삭제된 호스트에는 핸들이 남은 정지 상태의 이름 없는 계정이 남아 `checkHandle`이 사용 중이라고 보고함; 신원, 권한 부여, 설정, 요청, 논의, Auth 사용자는 사라짐; 복원과 재삭제는 거부됨; 같은 Google subject는 새 계정을 얻음. 요청 하나는 그 대화 및 그 위에서 아직 기다리는 턴 응답과 함께 삭제됨; 예약 쓰기가 있을 수 있는 종료된 요청은 보존으로 유지됨; 예약 쓰기가 있을 수 있는 동안에는 삭제가 거부됨; Data API 역할은 모든 함수에서 거부됨. `lib/server/data-deletion.test.ts`의 단위 테스트 |
| 데이터 고지 | 390px와 1280px에서의 `tests/e2e/privacy.test.ts`: 영어와 한국어 고지가 각 절과 함께 표시되고 가로 스크롤이 없음, 그리고 `/`와 호스트 페이지에서의 링크; `tests/e2e/requester-intake.test.ts`가 **Continue with Google** 아래의 링크를 확인함 |
### 프로덕션 확인, 읽기 전용

2026-10-23(06:55 UTC)에 구현 세션이 `findmeatime-release`의 현재 **production** 배포(`dpl_2kZrdFKxF1eukJH1irgwH4VMM9wF`, 6단계 병합보다 앞선 2026-10-23 07:02 KST의 CLI 배포)를 대상으로 실행했습니다. 아무것도 변경하지 않았습니다.

| 점검 | 명령 | 결과 |
|---|---|---|
| 도메인 | `vercel domains inspect findmeatime.com --scope justdodos-projects` | `findmeatime-release`가 `findmeatime.com`과 `release.findmeatime.com`을 서비스함; `findmeatime-dev`는 `dev.findmeatime.com`을 보유함. 네임서버는 의도대로 Cloudflare 것을 유지함 |
| DNS 레코드 | `cf dns records list --zone findmeatime.com` | 세 이름의 `A` 레코드가 `proxied: false`로 `76.76.21.21`을 가리킴; Cloudflare Email Routing의 MX, SPF, DKIM, DMARC 레코드는 바뀌지 않음 |
| DNS 조회 | `dig +short A findmeatime.com @1.1.1.1`과 `release.findmeatime.com`에 대한 같은 명령 | 둘 다 `76.76.21.21` |
| 두 오리진의 HTTPS | `/`, `/app`, `/eve/v1/health`, `/SKILL.md`, `/llms.txt`의 `curl` | 모두 200; HSTS와 Content Security Policy가 있음 |
| 원시 런타임 경로 | 인증되지 않은 `POST /eve/v1/session` | 401 |
| `dev.findmeatime.com` | `/`의 `curl` | 404: `findmeatime-dev`에 이를 서비스하는 현재 배포가 없으므로 스테이징은 라이브가 아님 |
| 지연(D4) | `npm run perf:check -- --origin https://findmeatime.com`과 `--origin https://release.findmeatime.com`, 서울에서 경로마다 순차 표본 20개 | 모든 경로 통과. `findmeatime.com`: `/` p50 155ms, p95 267ms; `/SKILL.md` 269ms와 431ms; `/llms.txt` 255ms와 286ms; `/eve/v1/health` 250ms와 470ms. `release.findmeatime.com`: 200ms와 446ms; 262ms와 287ms; 250ms와 831ms; 273ms와 321ms. 승인에서 예약까지의 시간과 첫 응답 시간은 측정되지 않음 |
| 릴리스 프로젝트 | 읽기 전용 `supabase db query --linked --project-ref mriseqztcwmezvtawnbo` | 여전히 1차 반복의 프로토타입임([공급자 설정](03_provider_setup.md#supabase-project)); 비워지지 않음 |

