# Find Me a Time — 구현 계획

> 한국어 번역본 (검토용). 원본: documentations/technical_specification/06_implementation_plan.md

상태: 팀 검토를 위한 계획. 1단계와 2단계 병합됨\
날짜: 2026-10-19\
근거: [PRD](../02_product_requirements.md), [기술 개요](../04_technical_specification.md), [백엔드](01_backend_architecture.md), [프런트엔드](02_frontend_architecture.md), [제공자 설정](03_provider_setup.md), [에이전트 구성](04_agent_configuration.md), [호스트 온보딩 흐름](../user_experience/05_host_onboarding_flow.md), [게스트 예약 흐름](../user_experience/06_guest_booking_flow.md), [기능 명세](../../openspec/specs/).

이 계획은 재구축을 범위가 정해진 OpenSpec 변경들로 순서화합니다. 요구사항을 추가하지 않습니다. 아래의 모든 동작은 PRD 또는 기능 명세가 소유하며, 이 계획은 순서, 범위 경계, 결정 기한, 각 조각이 만들어야 하는 증거만 정합니다. 이 계획과 소유 문서가 서로 다르면 소유 문서가 우선하며 이 계획을 바로잡습니다.

## 1. 고정된 기반

다음은 합의된 사항이며 이 계획에서 다시 논의하지 않습니다.

| 영역 | 결정 | 소유 문서 |
|---|---|---|
| 스택 | Next.js App Router, React, TypeScript, npm; 대화 런타임으로서 eve를 루트 `vercel.ts`를 통해 별도 서비스로 구성; shadcn/ui와 선별한 AI Elements; Thyme 시각 방향 | [프런트엔드](02_frontend_architecture.md), [DESIGN.md](../../DESIGN.md) |
| 기반 템플릿 | eve 채팅 템플릿을 복사한 뒤, 실제 호스트 데이터를 다루기 전에 템플릿의 신원과 영속성을 Supabase Auth와 우리의 내구성 있는 도메인 저장소로 교체 | [참조 저장소](02_frontend_architecture.md#reference-repositories) |
| 신원과 데이터 | Google 전용 호스트 로그인을 쓰는 Supabase Auth; 공유 프로젝트 `anelszynxtvxoxqvzgqt`의 PostgreSQL 17; 팀원별 개인 샌드박스; pg-delta 선언적 스키마 | [제공자 설정](03_provider_setup.md), [AGENTS.md](../../AGENTS.md#supabase-schema-changes) |
| 제공자 | Google Calendar와 Google Routes; `no-reply@findmeatime.com`에서 발송하는 Cloudflare Email Service; 요청자 이메일 대화를 위한 AgentMail; 호스트 iMessage를 위한 Photon Spectrum; Cloudflare DNS를 쓰는 Vercel 호스팅 | [기술 개요](../04_technical_specification.md) |
| 에이전트 접근 | 리소스에 바인딩된 OAuth를 쓰는 원격 MCP와 얇은 사용자 CLI; 별도의 관리자 CLI | [CLI 방향](05_cli.md), [설계 원칙](../03_design_principles.md) |
| 권한 | 애플리케이션이 호스트 자격, 제안 버전, 합의, 승인, 멱등성, 예약 조정을 소유합니다. 런타임 세션, 도구 승인, OAuth 허가는 미팅을 승인하지 않습니다 | [에이전트 구성](04_agent_configuration.md) |
| 라우트 | `/`, `/auth/sign-in`, `/app`, `/{handle}`, `/booking/[bookingId]`, `/connect/authorize`, `/SKILL.md`, `/{handle}/SKILL.md`, `llms.txt` | [페이지 목록](../user_experience/04_page_list.md) |
| 릴리스 오리진 | `https://release.findmeatime.com`; 2026-10-19부터 사용자의 요청으로 같은 배포가 `https://findmeatime.com`도 정식 오리진으로 제공 | [배포 오리진](03_provider_setup.md#deployment-origin) |

## 2. 작업 모델

- **하나의 변경, 하나의 브랜치, 하나의 풀 리퀘스트.** 아래 각 단계는 하나 이상의 OpenSpec 변경입니다. 브랜치 이름은 변경 이름을 재사용합니다(예: `feat/application-foundation`). AI 사용량이 올바르게 귀속되도록 모든 세션은 해당 작업 자신의 브랜치에서 시작합니다.
- **명세 먼저, 그다음 코드, 그다음 보관.** 변경은 델타 명세와 작업 목록과 함께 제안되고, 검토를 거쳐, 테스트와 함께 구현되고, 검증된 뒤에야 `openspec/specs/`로 보관됩니다. 보류 중인 델타는 주 명세 본문이 절대 일찍 되지 않습니다.
- **스키마 변경은 한 방향으로만 흐릅니다.** `supabase/schemas/` 아래의 원하는 SQL, 같은 풀 리퀘스트에서 Docker를 가진 팀원이 생성한 검토된 pg-delta 마이그레이션, `supabase db push`로 개인 샌드박스에 적용, 그리고 병합 시 CI만이 공유 프로젝트에 푸시합니다. Studio 편집은 금지됩니다.
- **증거는 인수 시나리오에 첨부됩니다.** 픽스처는 로직을 증명하고, 통제된 제공자, 기기, 명명된 클라이언트 확인은 연동을 증명합니다. 어느 쪽도 다른 쪽을 대체하지 않습니다. 토큰, 개인 텍스트, 원본 대화 기록은 추적되는 증거에 포함하지 않습니다.
- **프로덕션 외에서는 메시징이 거부됩니다.** 프리뷰와 로컬 배포는 이메일이나 iMessage를 보낼 수 없으므로, 채널 인수는 식별된 프로덕션 배포에서 허가된 수신자와 함께만 실행됩니다. 로컬 실행은 루프백 대역 제공자에만 닿을 수 있으며, [3단계 제안서](../../openspec/changes/requester-intake-and-feasibility/proposal.md#conflicts-resolved-here)가 메시징 환경 계약을 그렇게 바로잡습니다.
- **참조 저장소를 먼저.** 모듈을 설계하거나 구현하기 전에 5절에서 해당 단계에 나열된 파일을 읽고, 우리 계약이 달리 정하지 않은 곳에서는 그 아키텍처, 스타일, 테스트를 따릅니다. 따른 저장소와 리비전을 풀 리퀘스트에 명시합니다.

팀 병렬 작업: 0단계와 1단계는 모든 것이 이에 의존하므로 직렬입니다. 2단계부터는 4인 팀이 두세 개의 변경을 나란히 진행할 수 있으며, 4절의 의존성 표가 겹칠 수 있는 부분을 보여 줍니다.

## 3. 0단계 — 기준선 정리 (첫 변경 이전)

OpenSpec 변경은 필요하지 않습니다. 1단계를 막고 있는 유지보수 수정과 결정입니다. 모든 항목은 서로 독립적이어서 각각 다른 사람에게 맡길 수 있고, 한 풀 리퀘스트로 함께 반영할 수 있을 만큼 작습니다.

- [x] `DESIGN.md`에서 `documentations/03_design_principles.md`로 가는 깨진 링크를 수정합니다. 링크 검사기가 README 외의 루트 파일을 건너뛰어서 놓쳤습니다. 링크가 해석되면 완료입니다.
- [x] 같은 종류의 오류가 재발하지 않도록 `scripts/check-documentation.mjs`를 루트 Markdown 파일(`DESIGN.md`, `AGENTS.md`)까지 확장합니다. `npm run check:docs`가 이를 포함하면 완료입니다. 이제 검사기는 심볼릭 링크를 제외한 모든 루트 Markdown 파일을 읽으므로 `CLAUDE.md`가 두 번 집계되지 않습니다.
- [x] 1차 이터레이션의 iMessage 산출물을 정리합니다. `openspec validate --all --strict`가 `imessage-agent`의 자리표시자 Purpose에서 실패하여 Check 워크플로가 깨집니다. `host-imessage-assistant` 변경은 여기에 존재하지 않는 Drizzle 테이블과 `apps/web/src` 경로 위에 서비스가 보내는 환영 메시지를 설계하고 있으나, PRD는 이제 호스트가 보내는 연결 코드를 선택합니다. 결정이 기록되고(둘 다 폐기하고 6단계에서 iMessage를 다시 명세하거나, 지금 명세의 Purpose를 다시 작성) `npm run check`가 통과하면 완료입니다. 2026-10-19에 결정됨: 둘 다 폐기하며, [OpenSpec 상태](../../openspec/README.md)에 기록되어 있습니다. 6단계에서 대체본을 작성합니다.
- [x] 시작에 필요한 런타임 기반 결정을 기록합니다: eve 버전 고정과 검토한 템플릿 리비전, 모델 식별자와 컨텍스트 윈도우, 영속성과 워커 배치, 의존성 고정. 1단계 제안서에 나열되면 완료입니다. [`application-foundation` 설계](../../openspec/changes/application-foundation/design.md)에 기록됨: 템플릿 `8c55ea7c132f`, `eve` 0.80.1과 `ai` 7.0.143, 32,000토큰 압축 윈도우를 쓰는 직접 OpenAI `gpt-5.6-terra`, `pg_net`과 `pg_cron`이 깨우는 워커를 쓰는 Postgres 작업, 리전 `cle1`.
- [x] 각 팀원의 환경을 설정합니다: 훅(`git config core.hooksPath .githooks`), Supabase CLI 2.119.0, OpenSpec 1.14.0, 개인 Supabase 프로젝트, 로컬 및 샌드박스 콜백이 있는 Google OAuth 클라이언트. 각 팀원이 1단계 체크아웃을 로컬에서 실행할 수 있으면 완료입니다. 훅, CLI 버전, 개인 Supabase 프로젝트, OAuth 클라이언트에 대해서는 2026-10-19에 팀이 확인함. 체크아웃 실행 자체는 1단계 뼈대가 반영된 뒤에야 가능하며, 기반 변경의 작업 1.7이 이를 검증합니다.
- [x] 오래된 워크트리와 브랜치를 정리합니다. 열두 개의 Codex 워크트리와 `.claude/worktrees` 아래 두 개가 잘못 귀속된 사용량을 유발합니다. 남아 있는 모든 워크트리가 활성 상태이거나 다른 곳에 저장되지 않은 작업을 담고 있으면 완료입니다. 2026-10-19에 2026-10-10 이전부터 유휴 상태인 깨끗한 워크트리 다섯 개와 이미 `origin/main`에 병합된 로컬 브랜치 네 개를 제거함. 유지한 것: 커밋되지 않은 작업이나 참조되지 않는 커밋이 있는 워크트리, 정리 시점 기준 이틀 이내에 파일이 변경된 워크트리(Codex 워크트리 세 개, 마지막 변경 2026-10-17~2026-10-19), 병합되지 않았거나 푸시되지 않은 작업이 있는 모든 브랜치.

## 4. 단계

각 단계는 범위, 충족해야 하는 명세, 단계 안에서 확정해야 하는 결정, 단계를 닫는 증거를 나열합니다. 단계 번호는 우선순위가 아니라 전달 순서입니다.

범위 항목은 체크박스이므로 구현하는 에이전트나 팀원이 그 항목을 반영하는 풀 리퀘스트에서 완료로 표시할 수 있습니다. 단계 안에서 항목은 **레인(lane)**으로 묶입니다. 레인은 명시된 선행 조건과 합류 지점을 제외하면 다른 레인을 기다리지 않고 한 사람 또는 한 에이전트가 자신의 브랜치에서 수행할 수 있는 항목의 집합입니다. 레인은 범위를 바꾸지 않으며, 무엇이 나란히 진행될 수 있는지만 말해 줍니다.

### 1단계 — `application-foundation`

목표: 동작하고, 인가되며, 비어 있는 제품. 호스트가 Google로 로그인하고, `/app`에 도착하여, 아직 도구가 없는 설정 세션에서 Thyme와 대화할 수 있습니다. 예약 가능한 것은 아직 없습니다.

범위. 모든 레인의 선행 조건: 아래의 뼈대는 단계 초반 며칠 안에 한 사람이 완료하고, 레인이 갈라지기 전에 병합합니다.

**뼈대 (직렬, 가장 먼저)**

- [x] 검토한 리비전의 eve 채팅 템플릿을 복사하고, `apps/web/`, `agent/`, `lib/contracts/`, `lib/server/`, `tests/`를 만들고, npm으로 전환하고, 의존성을 고정하고, 빌드, 린트, 타입 검사, 테스트 명령을 추가해 Check 워크플로에 연결합니다.

**레인 A — 웹과 런타임** (실제 세션을 인가하려면 레인 B의 호스트 계정이 필요하며, 그때까지는 스텁 principal로 개발)

- [x] 대화 우선 레이아웃, 간결한 메뉴, 사이드바 없음으로 템플릿의 채팅 브리지를 렌더링하는 `/app` 셸.
- [x] 모든 `/eve/v1/*` 라우트에 대한 애플리케이션 소유 인가(eve가 동작하기 전에 애플리케이션 세션 인덱스와 대조하는 세션 소유권 검사 포함); 애플리케이션 인증 항목만 있고 `localDev()`와 `vercelOidc()`는 없는 `channels/eve.ts`; 브라우저 메시지는 애플리케이션 라우트를 통해서만 eve에 도달; 기본 차단(fail-closed) 기본 엔드포인트; 업로드 비활성화.
- [x] 재연결을 위한 저장된 스트림 이벤트와 세션 커서; 명시적 전환으로서의 종료 상태 복구.
- [x] 템플릿의 스타일링을 대체하는 Thyme 테마 토큰, 글꼴, 종이 레이어, 공유 컴포넌트 레시피.

**레인 B — 데이터와 신원** (독립적; 스키마 기준선과 이를 푸시하는 CI 작업이 가장 먼저 단독으로 병합되며, 다른 레인은 그 이후에만 테이블을 추가)

- [ ] Supabase 스키마 기준선: 비공개 및 노출 네임스페이스, 역할 매트릭스, 명시적 grant와 revoke, 노출 테이블의 RLS, 그리고 일회용 로컬 데이터베이스와 각 샌드박스에서 검증된 첫 pg-delta 마이그레이션 체인. 열림: 배포 워크플로(작업 2.3)는 저장소 시크릿이 설정되지 않아 한 번도 실행되지 않았습니다.
- [ ] 한 동의 화면에서 신원과 Calendar 스코프를 받는 Google 전용 Supabase Auth 로그인, PKCE, 오프라인 접근, 기록된 부여 스코프와 암호화된 리프레시 토큰, `/app`으로만 돌아가는 `/auth/callback`, 이메일 로그인 비활성화. 열림: OAuth 앱의 게시 상태와 샌드박스 콜백이 기록되지 않았습니다(작업 2.8).
- [x] 개방형 호스트 가입: Google 신원당 활성 호스트 계정 하나; 공유 자격-준비도 가드(eligibility-and-readiness guard).

**레인 C — 플랫폼 메커니즘** (독립적; 자체 테스트를 갖춘 순수 서버 모듈)

- [x] 애플리케이션 명령 파이프라인: 검증된 의도, 기대 리비전, 재시도 식별자, 대상에 안전한 오류.
- [x] 내구성 있는 작업 기반: 도메인 전환과 함께하는 원자적 게시, 한정된 리스, 펜싱, 재전달에 안전한 완료, 반복 복구, 프로덕션에서 생산된 작업만 가져가는 프로덕션 전용 워커.
- [x] 모델 인스턴스를 감싸는 모델 한도 미들웨어: eve의 재시도와 압축을 포함한 모든 제공자 호출이 입력 크기, 출력 상한, 제공자 마감 시간을 검사받고 먼저 내구성 있는 허용량을 예약함; 기반 설계가 기록한 대로 팀 키를 쓰는 직접 OpenAI.
- [x] 프리뷰가 발송할 수 없도록 하는 메시징 환경 거부.

**합류** (모든 레인 이후): 로그인한 호스트가 `/app`에 도착하고, 인가된 빈 설정 세션을 열며, 프로덕션 배포가 릴리스 오리진에서 이를 제공합니다.

- [x] 레인 A의 세션 인가를 레인 B의 호스트 계정과 레인 C의 명령 파이프라인에 연결합니다.
- [x] 아래의 1단계 증거 목록을 실행합니다. [인수 기록](07_acceptance_record.md#phase-1--application-foundation)에 기록되어 있습니다.

명세: [chat-workspaces](../../openspec/specs/chat-workspaces/spec.md)(Google 전용 로그인, 단일 호스트 워크스페이스, 대화 우선 진입), [host-admission](../../openspec/specs/host-admission/spec.md)(개방형 가입, 자격 가드), [conversation-access](../../openspec/specs/conversation-access/spec.md), [model-execution](../../openspec/specs/model-execution/spec.md), [application-commands](../../openspec/specs/application-commands/spec.md), [durable-jobs](../../openspec/specs/durable-jobs/spec.md), [messaging-environments](../../openspec/specs/messaging-environments/spec.md).

결정: 템플릿 리비전, eve 버전, 의존성 고정, 모델, 데이터 접근, 내구성 있는 배치, 리전은 0단계에서 [기반 변경](../../openspec/changes/application-foundation/proposal.md)에 기록되었습니다. 이 단계는 내구성 있는 배치를 장애 테스트로 확인하고 압축 임계값을 조정합니다. `evaluate_candidates`가 eve 워크플로 도구인지 애플리케이션 작업인지는 처음 사용되는 3단계로 넘어갑니다.

증거: 두 호스트 간 격리, 인가되지 않은 원본 런타임 라우트, 취소되었거나 재생된 로그인, 재연결 대비 종료 상태 복구, 모델 한도 소진, 프리뷰 메시징 거부; `supabase db reset --local`이 체인을 다시 구축함; 프로덕션 배포가 릴리스 오리진에서 `/app`을 제공함. AC-26 전반부(로그인은 정확히 하나의 계정을 만들고, 반복해도 추가로 만들지 않음).

### 2단계 — `host-onboarding`

목표: 로그인한 호스트가 설정을 완료하고 공개 예약 링크와 스킬 문서를 얻습니다.

범위. 선행 조건: 1단계 합류. 세 레인은 최종 검토 카드 전까지 독립적이며, 검토 카드는 레인 B의 분석 결과와 레인 C의 핸들 규칙이 필요합니다.

**레인 A — 설정 대화와 카드**

- [x] 설정 세션 도구 `read_setup_state`와 `draft_settings`; 1단계의 최소 `base.md` 위에 얹는 `host-setup.md` 지침 조각; 한 번에 하나씩 공개되는 작성된 온보딩 메시지.
- [x] 시간대, 야간 구간을 포함한 주간 가능 시간대, 주간 미팅 상한, 메모성 이벤트 제외, 소요 시간과 버퍼에 대한 제안 카드. 각각 명시됨, 추론됨, 시작용 기본값 중 하나로 표시하며 **이대로 사용(Use this)**, **조정(Adjust)**, **직접 선택(Choose my own)**을 제공.
- [x] 명시적인 방식, 장소, 이동 수단 질문 카드; 온라인 전용이면 장소와 이동 수단을 건너뜀.
- [x] 최종 검토 카드와 트랜잭션 방식 준비도 재확인을 갖춘 **제안된 설정 확인 및 저장(Confirm and save proposed settings)**; 준비도에서 도출된 공개 프로필; 공유 링크 카드.

**레인 B — Google Calendar와 분석**

- [x] 실제 캘린더와 이유를 바탕으로 한 캘린더 역할 카드; 쓰기 가능한 예약 대상 확인; 스코프를 거절했을 때의 **Google Calendar 연결(Connect Google Calendar)**; **Google 연결 관리(Manage Google connection)**.
- [x] 저장된 충돌 확인 캘린더를 과거와 다음 4주에 걸쳐 내구성 있는 작업으로 수행하는 자동 첫 스캔; 표본 수를 포함한 네 가지 분석 차원; **다시 분석(Analyze again)**.
- [x] 채택된 값은 보존하는 예약된 유지보수에 의한 24시간 증거 정리.

**레인 C — 신원, 진입 문서, 운영자 통제**

- [x] 예약어 목록, 고유성, 변경 한도를 갖춘 핸들; 가입 남용 한도.
- [x] 공개 진입 문서 `/SKILL.md`, `/{handle}/SKILL.md`, `llms.txt`, 페이지 내 에이전트 섹션, 대체 링크, Markdown 콘텐츠 협상; 핸들보다 먼저 해석되는 예약 라우트 이름.
- [x] 정지와 복원, 운영자 권한 경계를 갖춘 관리자 CLI.

**합류**

- [x] 검토 카드를 분석 증거와 핸들 검증에 연결하고, 2단계 증거 목록을 실행합니다. [인수 기록](07_acceptance_record.md#phase-2--host-onboarding)에 기록되어 있으며, 로그인한 상태의 프로덕션 실행과 Google 앱 검증은 거기서 계속 열려 있습니다.

명세: [host-admission](../../openspec/specs/host-admission/spec.md)(정지, 핸들, 남용 한도, 안정적 신원), [calendar-analysis-retention](../../openspec/specs/calendar-analysis-retention/spec.md), [public-agent-entry](../../openspec/specs/public-agent-entry/spec.md), [meeting-feasibility](../../openspec/specs/meeting-feasibility/spec.md)(야간 구간 규칙), [chat-workspaces](../../openspec/specs/chat-workspaces/spec.md). 또한 기반 변경이 여기로 미룬 도구 결과 복구 시나리오를 위해 [conversation-access](../../openspec/specs/conversation-access/spec.md)도 참조합니다.

여기서 확정할 결정: 가입 및 핸들 변경의 수치 한도와 예약 핸들 목록; 가능 시간대, 소요 시간, 버퍼의 시작용 기본값; 지원하는 이동 수단; 분석 보존 기간 확인; 관리자 CLI의 패키징, 이름, 운영자 인증.

증거: AC-26 전체, AC-28, [온보딩 흐름 체크리스트](../user_experience/05_host_onboarding_flow.md#checks-before-calling-the-flow-done)의 FR-04 확인; 기록된 Google 앱 검증 상태.

### 3단계 — `requester-intake-and-feasibility`

목표: 요청자가 준비된 호스트에 도달하고, 이해되고, 실현 가능한 후보를 봅니다. 아직 승인되거나 예약된 것은 없습니다.

범위. 선행 조건: 1단계 합류와, "준비된 호스트"가 존재하도록 2단계 레인 C의 준비도 가드. 그전에는 픽스처 호스트로 충분합니다. 레인 C는 순수 도메인 코드이며 1단계 뼈대가 반영되는 즉시 시작할 수 있습니다. 모든 레인은 아래 제안서도 기다리며, 어떤 레인이 코드를 작성하기 전에 이를 검토합니다.

**제안서 (직렬, 가장 먼저)**

- [x] 결정할 사항과 범위 표를 담은 [`requester-intake-and-feasibility`](../../openspec/changes/requester-intake-and-feasibility/proposal.md) 제안서.
- [x] [설계](../../openspec/changes/requester-intake-and-feasibility/design.md).
- [x] [`specs/`](../../openspec/changes/requester-intake-and-feasibility/specs/) 아래의 델타 명세.
- [x] [작업 목록](../../openspec/changes/requester-intake-and-feasibility/tasks.md).
- [x] 소유 문서 갱신과 한국어 미러.
- [ ] 팀원 검토.

**레인 A — 라우트, 신원, 시간대**

- [x] `/{handle}` 공개 접수와, 해시된 무작위 UUID 자격 증명, 30일 수명, `Referrer-Policy: no-referrer`, 색인 금지, 일반적인 이용 불가 화면을 갖춘 `/booking/[bookingId]`.
- [x] 게스트 신원 및 시간대 카드; 신원과 읽기 전용 Calendar 스코프를 별도의 요청 바인딩 허가로 기록하는 요청자용 **Google로 계속(Continue with Google)**; 간단한 이름과 이메일 카드를 쓰는 **Google 없이 계속(Continue without Google)**.
- [x] 7일 및 구간 종료 시점 만료를 갖춘 요청 수명주기; 철회.

**레인 B — 연락처 증명과 이메일 전달**

- [x] 전달 증거와 고정된 디스패치 식별자를 갖춘 Cloudflare Email Service 어댑터.
- [x] 선택적 연락처 확인: 예약 링크와 일회용 확인 링크를 담은 생성 이메일, 한도가 있는 재전송, 복구 가능한 전송 명령.
- [x] 수신자별 및 서비스 전체 예산과 일반적인 피드백을 갖춘 한정된 링크 재전송.
- [x] 대화 입력의 자격 증명 마스킹; 대화 접수 예산과 복구 가능한 스로틀링.

**레인 C — 실현 가능성 엔진**

- [x] 결정론적 실현 가능성: 전체 구간, 날짜별 오프셋과 일광 절약 시간 처리, 바쁨 및 집중 제약, 야간 구간, 선호로서의 주간 미팅 상한.
- [ ] 호스트 버퍼를 포함해 Google Routes로 계산하는 양방향 이동 구간; 해결되지 않은 이동은 절대 0으로 계산하지 않음; 수동 허용치 입력. 남은 일: 서울의 두 주소 사이에서 어떤 이동 수단이 경로를 반환하는지 실제로 확인하는 작업(작업 5.2).
- [x] 자격 증명 갱신, Calendar 읽기, Routes, 순위 지정에 걸친 공유 18초 평가 마감 시간; 유효한 후보에 대해서만 수행하는 모델 순위 지정.

**레인 D — 요청자 대화**

- [x] 요청자 세션 도구 `read_request`(요청자 프로젝션), `draft_request_review`, `evaluate_candidates`; 지침 조각 `requester.md`.
- [x] 영어와 한국어로 작성된 확인 질문을 갖춘 선언된 의도 추출; 기대 리비전을 갖춘 검토된 적용; 시간적으로 유효한 구간.
- [x] 후보 시간 카드, **이 시간으로 선택(Choose this time)**, 정확한 제안 버전, **이 제안에 동의(Agree to this proposal)**.

**합류**

- [ ] 레인 C가 레인 D의 도구를 통해 공급하는 후보 카드; 불변 버전에 대해 기록되는 동의; 3단계 증거 목록을 실행합니다. 남은 일: 증거 목록에는 운영 배포, 제공자 설정, 통제된 받은편지함이 필요합니다(작업 7.1, 8.1–8.3). 픽스처와 로컬 여정 테스트는 통과합니다.

명세: [meeting-requests](../../openspec/specs/meeting-requests/spec.md), [meeting-feasibility](../../openspec/specs/meeting-feasibility/spec.md), [email-delivery](../../openspec/specs/email-delivery/spec.md)(트랜잭션 발송, 전달 증거, 불확실한 디스패치), [chat-workspaces](../../openspec/specs/chat-workspaces/spec.md)(접수, 마스킹, 안정적인 요청자 목적지), [conversation-access](../../openspec/specs/conversation-access/spec.md). 또한 기반 변경이 여기로 미룬 저장된 순위 시나리오를 위해 [model-execution](../../openspec/specs/model-execution/spec.md)도 참조합니다.

여기서 확정할 결정: 지원하는 지역과 경로 최신성; 수동 이동 허용치의 세분도; 온라인 미팅 링크를 누가 만드는가(이 단계의 요청자 동의가 링크 계획을 다루므로 4단계에서 옮겨 옴); 연락처 증명(코드 대신 선택적 확인으로 결정됨); Cloudflare 도메인 검증과 API 권한; `evaluate_candidates`가 eve 워크플로 도구인지 애플리케이션 작업인지; 요청 생성 한도; 재전송을 위한 예약 링크 저장; 로컬 메시징; 요청이 생기기 전에 공개 페이지가 모델 대화를 실행하는지; 동의 전 연락처 인증. Dohyeon Park이 2026-10-21에 이를 D1–D12로 결정했으며 [제안서](../../openspec/changes/requester-intake-and-feasibility/proposal.md#decisions)에 기록되어 있습니다. **팀원 검토(Teammate review)**는 그 검토를 다룹니다. 2026-10-22에 D13이 별도의 익명 접수를 대체해, 첫 메시지부터 게스트가 신원을 밝힐 때까지 초안 요청인 하나의 게스트 스레드로 바꾸었으며, 이는 변경의 작업 그룹 9에서 구현합니다.

증거: 접수와 후보까지의 AC-01, AC-02, 요청자 측 AC-03, AC-12, 철회에 대한 AC-13, AC-27; 확인 링크가 담긴 생성 이메일과 재전송된 링크를 통제된 Cloudflare 받은편지함으로 전달. [게스트 예약 흐름 체크리스트](../user_experience/06_guest_booking_flow.md#checks-before-calling-the-flow-done)의 키보드 및 휴대폰 너비 확인.

### 4단계 — `host-review-and-booking`

목표: 첫 종단 간 예약. 호스트가 검토하고 승인하면 이벤트가 Google Calendar에 존재하고 확인이 전달됩니다.

범위. 선행 조건: 실제 승인 대기 요청을 위한 3단계 합류. 레인 B와 C는 픽스처 요청을 대상으로 더 일찍 시작할 수 있습니다. 모든 레인은 아래 제안서도 기다리며, 어떤 레인이 코드를 작성하기 전에 이를 검토합니다.

**제안서 (직렬, 가장 먼저)**

- [x] 결정할 사항과 범위 표를 담은 [`host-review-and-booking`](../../openspec/changes/host-review-and-booking/proposal.md) 제안서.
- [x] [설계](../../openspec/changes/host-review-and-booking/design.md).
- [x] [`specs/`](../../openspec/changes/host-review-and-booking/specs/) 아래의 델타 명세.
- [x] [작업 목록](../../openspec/changes/host-review-and-booking/tasks.md).
- [x] 소유 문서 갱신과 한국어 미러.
- [ ] 팀원 검토.

**레인 A — 호스트 검토 대화**

- [x] `read_request`(호스트 프로젝션), `list_host_requests`, `evaluate_candidates`, `propose_shared_changes`, `read_booking_status`를 갖춘 호스트 비공개 요청 논의 세션; 지침 조각 `host-review.md`.
- [x] `/app`의 요청 선택 카드와 공유 논의 대 비공개 논의 전환.
- [x] **이 제안 승인(Approve this proposal)**, **변경 요청(Request changes)**, **거절(Decline)**을 갖춘 제안 검토 카드; **수정한 세부 정보 공유(Share revised details)**와 **제안 무시(Dismiss suggestions)**를 갖춘 **제안된 공유 변경 검토(Review proposed shared changes)**.
- [x] 선호만 면제하는 비공개 예외 제어를 갖춘 규칙 및 이동 검토.

**레인 B — 예약 작업**

- [x] 디스패치 직전에 합의, 승인, 실현 가능성을 재검증; 영속화된 예약 식별자, 목적지, 고정된 페이로드, 예약(reservation).
- [x] 한 호스트에 대한 경쟁 요청의 조율; 요청자를 참석자로 하여 예약 대상 캘린더에 이벤트 생성.
- [x] 불확실한 쓰기의 조정; 모든 것을 재검증하는 확정적 실패 재시도; 디스패치 증거 이전에만 허용되는 철회와 거절.

**레인 C — 확인과 알림**

- [x] 제품 발신자 아래 호스트 표시 이름, 상대방에게 가는 Reply-To, 무엇/언제/누구/어디 블록, **예약 보기(View booking)**, **미팅 참여(Join meeting)**를 갖추고, 캘린더 파트는 UID가 이벤트의 `iCalUID`와 일치할 때만 포함하는, 수신자별 언어와 시간대의 확인 이메일.
- [x] 새 버전, 거절, 만료, 장기 보류에 대한 요청자 상태 알림.
- [x] 예약 링크와 `/app`의 영수증; **예약 상태 확인(Check booking status)**.

**합류**

- [ ] 레인 A의 승인이 레인 B를 디스패치하고, 그 확정된 이벤트가 레인 C를 구동합니다. 통제된 Google Calendar와 받은편지함을 대상으로 4단계 증거 목록을 종단 간 실행합니다. 열림: 게스트 받은편지함의 사본. 프로덕션 예약, 호스트 Google Calendar의 이벤트, 캘린더 파트가 포함된 호스트 확인 메일은 2026-10-22에 확인되었고(작업 7.2), 픽스처와 로컬 여정은 통과합니다.

명세: [meeting-requests](../../openspec/specs/meeting-requests/spec.md)(불변 제안, 종료 가드, 대상 프로젝션), [meeting-feasibility](../../openspec/specs/meeting-feasibility/spec.md)(재검증 중 마감 시간, 예외), [email-delivery](../../openspec/specs/email-delivery/spec.md)(상태 알림, 확인 메시지), [durable-jobs](../../openspec/specs/durable-jobs/spec.md), [application-commands](../../openspec/specs/application-commands/spec.md). 또한 요청 탐색과 받은편지함 진입을 위해 [chat-workspaces](../../openspec/specs/chat-workspaces/spec.md), 별도의 논의 대상을 위해 [conversation-access](../../openspec/specs/conversation-access/spec.md)도 참조하며, 둘 다 기반 변경이 여기로 미룬 것입니다.

여기서 확정할 결정: Google Calendar 이벤트 소유권 세부 사항과 주최자 신원; 보류 상태 이메일 이전의 조정 기간; 리마인더 정책 또는 그 명시적 보류.

증거: AC-01 전체, AC-03, AC-04, 웹 전용 AC-06, AC-07, AC-08, AC-09, 웹 전용 AC-10, AC-13; 통제된 Google Calendar의 확정된 이벤트와 세부 정보가 일관된 통제된 받은편지함의 확인 이메일. 이 단계가 처음으로 시연 가능한 제품입니다.

### 5단계 — `agent-access`

목표: 개인 에이전트가 MCP와 사용자 CLI를 통해 두 역할 모두에서 동작하며, 클라이언트별 인수를 거칩니다.

범위. 선행 조건: 요청자 작업은 3단계, 호스트 결정은 4단계. 레인 A는 1단계 외에는 제품 의존성이 없으며 4단계가 시작되는 즉시 시작할 수 있습니다. 모든 레인은 아래 제안서도 기다리며, 어떤 레인이 코드를 작성하기 전에 이를 검토합니다.

**제안서 (직렬, 가장 먼저)**

- [x] 결정할 사항과 범위 표를 담은 [`agent-access`](../../openspec/changes/agent-access/proposal.md) 제안서.
- [x] [설계](../../openspec/changes/agent-access/design.md).
- [x] 한 건의 미래 요청 허가를 포함한 [`specs/`](../../openspec/changes/agent-access/specs/) 아래의 델타 명세.
- [x] [작업 목록](../../openspec/changes/agent-access/tasks.md).
- [x] 소유 문서 갱신과 한국어 미러.
- [ ] 팀원 검토.

**레인 A — 인가 서버**

- [x] S256 PKCE, 정확한 콜백, 보호된 리소스 및 인가 서버 디스커버리, 리소스에 바인딩된 서명 토큰, 원자적 일회용 코드, 리프레시 회전, 철회, 현재 허가 검사를 갖춘, MCP 인가 명세를 따르는 인가 서버.
- [x] `/connect/authorize` 동의 페이지; `/app`에서 연결된 클라이언트 조회와 철회.

**레인 B — MCP 서버와 사용자 CLI**

- [x] 역할에 적합한 작업과 대상 프로젝션을 갖춘, 공유 스케줄링 API 위의 원격 MCP 서버.
- [x] 구조화된 JSON 결과, 헤드리스 및 대화형 로그인, 안전한 저장, 유실된 응답에 대한 재인가를 갖춘 얇은 클라이언트로서의 사용자 CLI.

**레인 C — 요청자 부트스트랩과 클라이언트 인수**

- [x] 한 건의 미래 요청 허가 델타를 명세합니다: 표시된 호스트에 바인딩, 정확한 재시도 복구, 그 요청으로의 영구적 제한. 명세가 구현보다 앞섭니다.
- [x] 허가와 그 지속 제한을 구현합니다.
- [ ] 각 클라이언트에 대해 검증한 스킬 문서 문구; 클라이언트별 디스커버리 및 연결 메모. 열림: 문서는 두 MCP 엔드포인트와 CLI를 명시하고 [클라이언트별 메모](09_agent_clients.md)는 각 클라이언트의 연결 경로를 나열하지만, 이름이 지정된 클라이언트는 아직 하나도 실행되지 않았습니다. 이를 위해서는 프로덕션 배포와 팀원 계정 아래의 각 클라이언트가 필요합니다(작업 6.1).

**합류**

- [ ] 두 스킬 프롬프트를 명명된 각 클라이언트에서 두 역할로 실행하고, 5단계 증거 목록을 실행합니다. 열림: 스크립트된 MCP 클라이언트와 CLI는 한 요청에서 예약까지 로컬 합류를 통과합니다(`tests/integration/agent-join.test.ts`); 이름이 지정된 클라이언트는 모두 배포 뒤 프로덕션에서 각자 실행되어야 합니다(작업 6.1과 7.1, 그리고 [클라이언트별 메모](09_agent_clients.md)).

명세: [agent-client-authorization](../../openspec/specs/agent-client-authorization/spec.md), [public-agent-entry](../../openspec/specs/public-agent-entry/spec.md), [application-commands](../../openspec/specs/application-commands/spec.md), 그리고 새로운 요청자 부트스트랩 델타.

여기서 확정할 결정: MCP 프로토콜 버전과 클라이언트 등록 메커니즘; 권한 스코프; CLI 이름, 패키징, 지원 OS; 클라이언트별 호환성 테스트 환경.

증거: Dots, Muse, Instinct, ChatGPT, Codex, Claude, Claude Code 각각에 대한 AC-14, AC-15, AC-19부터 AC-25까지이며, 각자 자신의 두 역할 확인을 가집니다. 해결되지 않은 필수 클라이언트는 각주가 아니라 릴리스 차단 요소입니다.

### 6단계 — `host-imessage-channel`

목표: 연동된 호스트가 일상적인 스케줄링을 iMessage에서 처리합니다.

범위. 선행 조건: iMessage를 통한 설정을 위해 2단계, 결정을 위해 4단계. 레인 A의 스파이크는 레인 C의 전송 선택을 좌우하지만 명령 파싱은 좌우하지 않습니다. 폐기된 1차 이터레이션의 산출물을 확장해서는 안 되므로, 모든 레인은 아래 제안서가 어떤 레인이 코딩하기 전에 검토될 때까지 기다립니다.

**제안서(직렬, 먼저)**

- [x] [`host-imessage-channel`](../../openspec/changes/host-imessage-channel/proposal.md)의 제안서: 폐기된 1차 이터레이션의 `imessage-agent` 명세와 `host-imessage-assistant` 변경을 대체하며, 정해야 할 결정과 커버리지 표를 담습니다.
- [x] [설계](../../openspec/changes/host-imessage-channel/design.md).
- [x] [`specs/`](../../openspec/changes/host-imessage-channel/specs/) 아래의 델타 명세, 새로운 `host-imessage-channel` 기능.
- [x] [작업](../../openspec/changes/host-imessage-channel/tasks.md).
- [x] 소유 문서 갱신과 한국어 미러, 2026-10-23에 사용자가 결정한 원탭 딥링크 포함.
- [ ] 팀원 검토.

**레인 A — 전송 스파이크**

- [x] 스파이크: 네이티브 Photon 채널 대 애플리케이션이 소유하는 어댑터를 내구성 있는 수신, 확인 응답, 정확한 발신자 식별, 복구 증거를 기준으로 선택하고, 발신자 식별자 형식을 기록합니다.
- [x] 내구성 있는 수신 기록이 있는 서명된 수신기와 발신함이 있는 격리된 발신 전송을, Photon 대역과 서명된 웹훅 픽스처를 상대로 구현합니다.

**레인 B — 웹 워크스페이스의 연동 카드**

- [x] **iMessage 연결(Connect iMessage)**은 서버에서 일회용 연결 코드를 받아 곧바로 메시지 앱을 엽니다. 수신자는 회선 번호이고 입력란에는 정확한 연결 메시지가 들어갑니다(iOS는 `sms:<number>&body=<text>`, Android는 `sms:<number>?body=<text>`); 메시지 앱을 열 수 없는 곳에서는 인라인 카드가 번호, 코드, **복사(Copy)**, 같은 딥링크의 QR 코드를 보여 줍니다. 이어서 마스킹된 발신자의 **확인 및 연결(Confirm and link)**, 서비스 발송 6자리 대체 경로(**코드를 대신 보내 주세요(Send me a code instead)**)와 보호된 코드 입력란, 만료 및 재전송 한도, 연결 해제, **나중에(Maybe later)**. 메시지 앱을 여는 것은 연결로 간주되지 않습니다.
- [x] 큐에 있음, 수락됨, 실패, 불확실의 상태를 사실대로 보여 주는 선택 사항인 **연락처에 추가(Add to contacts)** 카드.

**레인 C — 채널과 명령**

- [x] 검증된 발신자를 선택된 요청과 함께 `host:{hostId}`로 매핑하는 `channels/photon.ts`; 연동되지 않았거나 그룹인 발신자에게는 세션이 없음; 수신 연결 메시지는 모델 턴 이전에 소비됨.
- [x] 정확한 명령 `request <reference>`, `review`, `changes`, 검토 참조가 있는 승인 및 거절, `setup`을 모델 턴 이전에 애플리케이션 명령으로 파싱.
- [x] 연동된 대화로 전달되는 제안 요약과 결과; `/app`에서 볼 수 있는 전달 실패; 접수 예산 아래의 큐에 있는 수신.
- [x] iMessage를 통한 설정: 제안 질문과 평범한 텍스트 답변이 공유 초안을 갱신; 최종 설정 확정은 현재 검토에 대해 작성된 정확한 명령을 사용.

**합류**

- [ ] 통제된 iPhone에서 연동하고, 요청을 선택하고, 수정하고, 승인한 뒤 6단계 증거 목록을 실행합니다.

명세: [chat-workspaces](../../openspec/specs/chat-workspaces/spec.md)(메시징 배압, 연동 증명의 마스킹), [messaging-environments](../../openspec/specs/messaging-environments/spec.md), [durable-jobs](../../openspec/specs/durable-jobs/spec.md), 그리고 새로운 `host-imessage-channel` 델타.

여기서 확정할 결정: 어댑터 선택과 발신자 식별자 형식; 회선 프로비저닝과 일일 신규 대화 허용량; 코드 만료와 재전송 한도; 플랫폼별 원탭 딥링크의 `sms:` 형식(2026-10-23에 사용자가 결정), 합류 단계에서 실제 iPhone으로 검증.

증거: 재시작 후 재생과 모의 전달 실패를 포함해 프로덕션 배포를 대상으로 통제된 iPhone에서 수행한 AC-16, AC-17, AC-18; 기록된 기기 및 클라이언트 버전.

### 7단계 — `requester-email-channel`

목표: 요청자가 이메일로 요청을 시작하고 이어 갈 수 있습니다.

범위. 선행 조건: 요청 바인딩을 위해 3단계, 알림을 위해 4단계. 두 레인은 채널에서 만납니다. 모든 레인은 아래 제안서도 기다리며, 어떤 레인이 코드를 작성하기 전에 이를 검토합니다.

**제안서 (직렬, 가장 먼저)**

- [x] 결정할 사항과 범위 표를 담은 [`requester-email-channel`](../../openspec/changes/requester-email-channel/proposal.md) 제안서.
- [x] [설계](../../openspec/changes/requester-email-channel/design.md).
- [x] [`specs/`](../../openspec/changes/requester-email-channel/specs/) 아래의 델타 명세.
- [x] [작업 목록](../../openspec/changes/requester-email-channel/tasks.md).
- [x] 소유 문서 갱신과 한국어 미러.
- [ ] 팀원 검토.

**레인 A — 수신**

- [ ] 좁게 범위가 정해진 런타임 권한을 가진 AgentMail 받은편지함 `findmeatime@agentmail.to`; 운영자 소유의 수신기 등록. 미해결: 받은편지함은 받은편지함 세 개 한도에 막혀 있으며, 수신기 등록은 `email-receiver` 운영자 명령으로 구현되어 있습니다.
- [x] 확인 응답 전에 중복 제거된 수신 기록과 하나의 작업을 저장하는 서명된 웹훅 수신기; 충돌하는 재사용은 거부.

**레인 B — 채널과 연동**

- [x] 스레드와 요청의 바인딩; 검증된 텍스트를 `request:{requestId}`로 전달하는 `channels/agentmail.ts`; 같은 스레드의 답장.
- [x] 예약 페이지에서 **이메일 링크 확인(Check email link)**과 **이메일 연결 해제(Unlink email)**를 갖춘 **이메일로 계속(Continue by email)** 연동.
- [x] 이메일에서 시작된 요청에 대한 스레드 내 상태 알림.

**합류**

- [ ] 요청자가 이메일로 시작하고, 연락처를 검증하고, 예약 링크에서 이어 가며, 스레드 알림을 받습니다. 7단계 증거 목록을 실행합니다. 미해결: 실제 다중 턴 받은편지함 전달에는 AgentMail 받은편지함, 그 웹훅, 공유 프로젝트 마이그레이션, 프로덕션 배포가 필요합니다(작업 6.1과 6.2). 이 여정은 `eve dev`와 AgentMail 스탠드인을 상대로 로컬에서 통과합니다.

명세: [requester-email-ingress](../../openspec/specs/requester-email-ingress/spec.md), [email-delivery](../../openspec/specs/email-delivery/spec.md)(대화형 재시도 식별자), [meeting-requests](../../openspec/specs/meeting-requests/spec.md).

여기서 확정할 결정: 사용자 정의 채널 대 Chat SDK 어댑터; 현재 계정 한도 아래의 받은편지함 할당; 전달된 링크 처리; 스레드 보존.

증거: AC-05, AC-11, 허가된 수신자와 함께하는 실제 다중 턴 받은편지함 전달. 제안된 호스트 이메일 확장은 범위 밖으로 유지됩니다.

### 8단계 — `operations-and-release`

목표: 팀이 제품을 운영하고, 점검하고, 복구할 수 있으며 루트 도메인에서 릴리스됩니다.

범위. 선행 조건: 진단이 점검할 대상을 갖도록 4단계; 나머지는 4단계 이후 언제든 시작할 수 있습니다. 네 레인은 서로 독립적이며, 모든 레인은 아래 제안서도 기다리며 어떤 레인이 코드를 작성하기 전에 이를 검토합니다.

**제안서 (직렬, 가장 먼저)**

- [x] 결정할 사항과 범위 표를 담은 [`operations-and-release`](../../openspec/changes/operations-and-release/proposal.md) 제안서.
- [x] [설계](../../openspec/changes/operations-and-release/design.md).
- [x] [`specs/`](../../openspec/changes/operations-and-release/specs/) 아래의 델타 명세.
- [x] [작업 목록](../../openspec/changes/operations-and-release/tasks.md).
- [x] 소유 문서 갱신과 한국어 미러.
- [ ] 팀원 검토.

**레인 A — 진단과 복구**

- [x] 관리자 CLI를 통한 운영 진단 스냅샷과 한정된 거부 관찰.
- [x] 불확실한 쓰기와 소진된 작업에 대한 감사되는 복구 작업.

**레인 B — 데이터 관리**

- [x] 합성 데이터로 채워진 상태를 사용한 격리된 데이터베이스로의 백업 복원.
- [x] 보존 및 삭제 규칙; AI 제공자의 데이터 처리와 동의 고지.

**레인 C — 환경과 도메인**

- [x] 마이그레이션 승격 경로: GitHub 환경 `release`의 수동 [`Deploy release Supabase`](../../.github/workflows/deploy-release.yml) 워크플로는 `main` 외의 ref와 프로토타입이 아직 남아 있는 프로젝트를 거부하며, 공유 프로젝트가 스테이징이 될 수 있도록 스테이징 메시지 차단도 함께 추가.
- [ ] 릴리스 환경 분리: `mriseqztcwmezvtawnbo`(FindMeATime2)를 비우고 연결, 별도의 Vercel 프로덕션 대상. 미결: 프로젝트에 아직 1차 반복의 프로토타입이 남아 있으며(2026-10-23에 읽기 전용으로 점검), 이를 비우는 일, `release` 환경의 비밀, 공유 프로젝트를 `findmeatime-dev`로 옮기는 일은 사용자의 조치를 기다리는 중.
- [ ] 루트 도메인 승격: `findmeatime.com`을 릴리스 프로젝트에 연결하고, Vercel이 요구하는 레코드를 프록시 없이 `cf`로 적용하고, 도메인 점검, DNS 조회, HTTPS 요청으로 검증하며, `release.findmeatime.com`이 계속 동작하도록 유지.
- [ ] 민감한 Calendar 스코프에 대한 Google 앱 검증; Photon과 AgentMail의 프로덕션 구성; 해당하는 Auth 알림을 위한 Cloudflare 사용자 정의 SMTP.

**레인 D — 인수 기록**

- [ ] 명령, 날짜, 리비전, 공백을 포함한 AC-01부터 AC-28까지의 인수 증거 기록. 1단계부터 유지하여 여기서 완성합니다.

명세: [operational-diagnostics](../../openspec/specs/operational-diagnostics/spec.md), [email-delivery](../../openspec/specs/email-delivery/spec.md)(Auth 알림), [messaging-environments](../../openspec/specs/messaging-environments/spec.md).

여기서 확정할 결정: PRD 2절의 측정 기간과 수치 목표; 지원 및 복구 담당; 성능 목표.

증거: 보류 중인 필수 클라이언트나 제공자 사례가 없는 완전한 인수 기록, 그리고 충족된 [제공자 설정](03_provider_setup.md#environment-and-activation-checklist)의 릴리스 체크리스트.

### 의존성과 중복

| 단계 | 의존 대상 | 겹칠 수 있는 대상 |
|---|---|---|
| 1 기반 | 0단계 | 없음 |
| 2 호스트 온보딩 | 1 | 스키마 기준선과 인증이 반영된 후의 3 |
| 3 요청자 접수와 실현 가능성 | 1; 준비된 호스트를 위한 2단계 준비도 가드 | 2 |
| 4 호스트 검토와 예약 | 2, 3 | 5의 인가 서버 작업 |
| 5 에이전트 접근 | 요청자 작업은 3, 호스트 결정은 4 | 6, 7 |
| 6 호스트 iMessage 채널 | iMessage를 통한 설정은 2, 결정은 4 | 5, 7 |
| 7 요청자 이메일 채널 | 3, 4 | 5, 6 |
| 8 운영과 릴리스 | 전체 | 진단은 4 이후 시작 가능 |

첫 번째 시연 가능한 마일스톤은 4단계의 끝입니다. 실제 Google Calendar를 통한 웹 전용 예약입니다. 그 이후 5, 6, 7단계는 각자 명명된 클라이언트, 기기, 받은편지함 인수를 갖는 세 개의 병렬 브랜치로 진행할 수 있습니다.

### 병렬로 진행되는 것

세 가지 병렬성을 사용할 수 있으며, 가장 안전한 것부터 조율이 가장 많이 필요한 것 순입니다.

1. **단계 안의 레인.** 위의 각 단계 아래에 나열되어 있습니다. 각 레인은 하나의 브랜치와 하나의 풀 리퀘스트, 또는 몇 개의 작은 풀 리퀘스트입니다. 레인은 서로 다른 모듈을 다루므로 병합 충돌은 뼈대 담당자가 검토하는 `lib/contracts/` 아래의 공유 계약에 머뭅니다.
2. **해당 단계에 앞선 순수 도메인 레인.** 3단계 레인 C(실현 가능성 엔진), 4단계 레인 B(픽스처 요청에 대한 예약 작업), 5단계 레인 A(인가 서버)는 1단계의 뼈대와 명령 파이프라인 외에는 UI나 제공자 의존성이 없습니다. 앞 단계의 대화 작업이 아직 진행 중일 때 시작할 수 있습니다.
3. **전체 단계를 나란히.** 호스트 온보딩과 요청자 접수는 준비도 가드만 공유하므로 2단계와 3단계는 1단계가 합류하면 겹칩니다. 5, 6, 7단계는 4단계 이후 서로 독립적입니다. 8단계 레인 A는 점검할 실제 작업을 기다리는 동안 레인 B, C, D는 4단계 이후 시작할 수 있습니다.

직렬로 유지되어야 하는 것:

- 모든 레인에 앞선 1단계의 뼈대와, 2단계나 3단계가 본격적으로 시작되기 전의 1단계 합류.
- 이후의 모든 테이블이 상속하는 네임스페이스, 역할, RLS를 정의하므로, 다른 모든 마이그레이션에 앞선 1단계 레인 B의 스키마 기준선.
- 레인이 코딩을 시작하기 전의 각 단계의 OpenSpec 제안서, 그리고 폐기된 산출물을 확장해서는 안 되므로 어떤 iMessage 코드보다도 앞선 6단계 제안서.
- 모든 변경에서 구현 전에 검토된 제안서, 델타 명세, 작업 목록, 그리고 보관 전의 검증.

4인을 위한 제안 분담, 한 사람당 하나의 브랜치이며 합류할 때마다 수정합니다.

| 단계 | 담당자 1 | 담당자 2 | 담당자 3 | 담당자 4 |
|---|---|---|---|---|
| 0단계 | 링크 수정과 검사기 | iMessage 산출물 결정과 6단계 제안서 초안 | 런타임 결정과 1단계 제안서 | 팀원 설정, 워크트리 정리 |
| 1단계 | 뼈대, 그다음 레인 A | 레인 B | 레인 C | 2단계와 3단계 제안서, 그다음 3단계 레인 C 조기 시작 |
| 2단계와 3단계 | 2단계 레인 A | 2단계 레인 B와 C | 3단계 레인 A와 D | 3단계 레인 B와 C |
| 4단계 | 레인 A | 레인 B | 레인 C | 5단계 레인 A 조기 시작, 5~7단계 제안서 |
| 5~7단계 | 5단계 레인 B와 C | 5단계 레인 A, 그다음 8단계 레인 C | 6단계 전체 레인 | 7단계 두 레인 |
| 8단계 | 레인 A | 레인 C | 레인 D와 클라이언트 재인수 | 레인 B |

Docker를 갖춘 팀원이 그 주에 마이그레이션이 필요한 레인의 마이그레이션을 생성합니다. 뼈대를 맡은 사람은 레인이 갈라지지 않도록 `lib/contracts/`와 에이전트 디렉터리 구성에 대한 모든 변경을 검토합니다.

## 5. 단계별 참조 저장소

[에이전트 지침](../../AGENTS.md#working-agreements)은 우리 계약이 달리 정하지 않는 한, 모든 모듈이 참조 저장소가 같은 것을 구성하고, 스타일을 정하고, 테스트하는 방식을 따르도록 요구합니다. [프런트엔드 아키텍처](02_frontend_architecture.md#reference-repositories)는 저장소들과 채택하지 말아야 할 것을 명시합니다. 이 절은 각 단계 전에 어떤 파일을 읽어야 하는지 설명합니다. 파일 목록은 2026-10-19에 저장소들의 `main` 브랜치에서 가져왔으며, 1단계 제안서가 검토한 정확한 커밋을 기록하고, 복사한 코드는 상위 프로젝트의 라이선스 고지를 유지합니다.

어느 단계에서든 이 순서로 읽습니다.

1. `.agents/skills/` 아래 포함된 스킬: `eve`, `ai-elements`, `shadcn`, `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `supabase`, `supabase-postgres-best-practices`. eve 버전이 고정된 뒤에는 `node_modules/eve/docs/README.md`가 버전 기준이며 둘이 다르면 스킬보다 우선합니다.
2. 참조 저장소 자체의 `AGENTS.md` 또는 `CLAUDE.md`, `docs/`, 테스트 구성을 읽어 우리 코드가 같은 관례를 따르도록 합니다.
3. 아래 단계별 행의 파일.

| 단계 | 시작 전에 읽을 것 | 가져올 것 | 가져오지 않을 것 |
|---|---|---|---|
| 1 기반 | eve 채팅 템플릿: 루트 `vercel.ts`(`apps/web`의 `web` 서비스를 갖는 `withEve`), `agent/agent.ts`, `agent/channels/eve.ts`(순서가 있는 `auth` 목록, `uploadPolicy: "disabled"`), `apps/web/lib/eve-auth.ts`(`principalId`, `principalType`, `authenticator`, `attributes`를 반환하는 `AuthFn`), `apps/web/app/_components/agent-chat*.tsx`, `apps/web/lib/chat/{events,persistence-client,provisional-chat,limits,types}.ts`, `apps/web/app/api/{bootstrap,chats}`, `apps/web/lib/setup.ts`, 그리고 `docs/how-the-chatbot-works.md`의 Runtime Model, eve Client Bridge, Persistence Model, Pending Message Recovery, Refresh And Resume, Rate Limiting, Event Log Invariants 절. OpenInstinct: `agent/hooks/session-owner.ts`(`session.started`와 `message.received`에서 `auth.initiator`를 위해 세션을 소유권 주장), `agent/lib/principal-scope.ts`(범위 불일치 시 기본 차단하는, Zod로 파싱한 principal 속성), `db/schema/sessions.ts`, `db/services/{sessions,scope}.ts`, `agent/instructions/*.ts`(번호가 붙은 조각), `agent/instrumentation/*`. Vercel chatbot: `app/(chat)/api/chat/[id]/stream/route.ts`, `components/chat/{messages,message,data-stream-provider,toast}.tsx`, `components/ai-elements/*`, 브라우저 테스트 모음 | 서비스 구성, 우리 자체 `AuthFn`을 먼저 두고 `localDev()`는 로컬에서만 쓰는 채널 인증 목록 형태, 재개를 위한 저장된 스트림 이벤트와 세션 커서, 애플리케이션이 소유하는 세션 인덱스와 대상 훅, 정직한 구성 상태로서의 설정 준비도, 번호가 붙은 지침 조각, 스트림 라우트와 메시지 렌더링 | Better Auth와 비밀번호 인증, Neon 위의 Drizzle, Upstash 속도 제한, 브라우저 로컬 채팅 저장소, 사이드바와 통합 메뉴, `agent/connections/*`, `agent/memory/profile.ts`, 배포 필요가 생기지 않는 한 `vercelOidc()`, pnpm 워크스페이스와 락파일, OpenInstinct의 워크스페이스 모델, chatbot의 아티팩트와 모델 선택기 |
| 2 호스트 온보딩 | OpenInstinct: `agent/lib/google-workspace/{client,calendar}.ts`와 `tests/google-workspace*.test.ts`(저장된 허가로 만든 사용자 범위 Google 클라이언트와 생성된 클라이언트 테스트), `agent/tools/ask_question.ts`(사용자에게 하는 구조화된 질문), `agent/lib/profile-memory.ts`와 `agent/memory/profile.ts`, `tests/profile-memory.test.ts`(리비전을 검사하는 한정된 레코드). personal-agent 템플릿: `app/components/AgentAuthorizationRequest.vue`, `app/components/AgentInputRequest.vue`, `app/composables/chat/useAuthorizationChallenges.ts`(타입이 있는 챌린지에서 렌더링되는 승인 및 입력 카드), `agent/lib/internal-api.ts`와 `docs/ARCHITECTURE.md`의 Internal API 및 Auth 절. eve 메모리 템플릿: `agent/lib/memory/scope.ts`와 그 테스트. 1차 이터레이션: F02 정규화 규칙, F04 추정 문구, F05 세 주제 확인. 설계 전용으로 cal.diy의 주간 가용성 편집기(아래 설계 표 참조) | 도메인 코드에서의 Google 클라이언트 구성과 테스트, 리비전을 검사하는 초안, 명시적 수락 및 조정 동작을 갖춘 타입 있는 카드 챌린지, 웹과 에이전트 서비스 사이의 내부 API 경계, 증거 대 정책 문구, cal.diy의 요일 행 편집 패턴 | 에이전트 도구로서의 Calendar, 첫 릴리스의 메모리 슬롯, Vue 컴포넌트 자체, Linear 또는 Slack 커넥터, 1차 이터레이션의 KST 전용 시간 코드와 Ollama 분류, cal.diy의 스케줄 데이터 모델 |
| 3 요청자 접수와 실현 가능성 | Vercel chatbot: `components/chat/{multimodal-input,greeting,suggested-actions}.tsx`, 빈 상태, 로딩 상태, 오류 상태, 브라우저 테스트. eve 채팅 템플릿: 접수 한도의 형태를 위한 `apps/web/lib/rate-limit.ts`와 `apps/web/lib/chat/limits.ts`. 1차 이터레이션: F02 `normalizeCalendarEvents`와 `convert` 규칙, F08 대칭 이동 구간과 오프라인 전용 앵커, F09 코드로 계산한 근거 문장, "결과 확인" 복구를 갖춘 횡단 멱등 작업 훅. 설계 전용으로 cal.diy의 예약 페이지와 시간대 화면(아래 설계 표 참조) | 작성기와 상태 패턴, 한도 적용 형태, 바쁨 의미와 제공자 식별자 중복 제거, 양방향 이동 규칙, 코드가 소유하는 설명, 고정된 재시도 명령, 시간을 고르기 위한 cal.diy의 정보 순서와 상태 | 업로드와 첨부 파일, 게스트 계정, 1차 이터레이션의 이동 테이블, 연락처 게이트와 클라이언트 우선 순위 지정, cal.diy의 모든 코드나 데이터 모델 |
| 4 호스트 검토와 예약 | OpenInstinct: `agent/lib/google-workspace/calendar.ts`(이벤트 생성 클라이언트 형태), `agent/channels/scheduled-run.ts`, `agent/lib/schedules/{request,report,report-lifecycle}.ts`, `agent/hooks/background-reply-target.ts`와 `agent/lib/reply-targets.ts`(시작된 대화로 다시 보고하는 백그라운드 작업). personal-agent 템플릿: `docs/ARCHITECTURE.md`의 요청 흐름. 1차 이터레이션: F10 영향 토큰 수락과 사전 점검 영수증, F11 자동 취소하지 않는 충돌 배지. 설계 전용으로 cal.diy의 성공 카드와 예약 이메일 템플릿(아래 설계 표 참조) | 예약 작업 결과가 올바른 논의에 도달하게 하는 응답 대상 패턴, 보고 수명주기 상태, 결정이 영향을 미치는 것의 서명된 스냅샷을 쓰는 미리 보기 후 확인, cal.diy의 영수증과 이메일 표현 | 제품 기능으로서의 예약 실행, Vercel cron 의존성, 앱 내 전용 이벤트, cal.diy의 일정 변경 및 취소 동작과 이메일 발송 코드 |
| 5 에이전트 접근 | eve 채팅 템플릿: `docs/how-the-chatbot-works.md`의 Authorization Flow For Connections(Connect 및 Skip) 절. personal-agent 템플릿: `app/pages/settings/integrations.vue`, `app/components/integrations/ConnectorCard.vue`, `app/composables/{useConnector,useConnectors}.ts`(철회가 가능한 연결된 클라이언트 목록). OpenInstinct: `app/api/auth/[...all]/_tests/auth-route.test.ts`(인증 엔드포인트의 라우트 테스트). 서버 구조와 도구 설명을 위한 포함된 스킬 `mcp-builder` | 동의 및 철회 UX, 라우트 테스트 구성, MCP 서버 관례 | 우리 OAuth 서버로서의 그들의 커넥터 허가 전부: 참조 중 MCP용 리소스 바인딩 인가 서버를 구현한 것은 없으므로 [에이전트 클라이언트 인가 계약](../../openspec/specs/agent-client-authorization/spec.md)과 MCP 인가 명세가 이를 지배합니다 |
| 6 호스트 iMessage 채널 | personal-agent 템플릿: `agent/channels/photon.ts`(`photonIMessageChannel`, `onMessage`는 `agent/lib/phone-internal.ts`를 통해 발신자 전화번호를 앱 사용자에 매핑하고 연동된 계정에서 세션 인증을 구성), `app/components/profile/PhoneInput.vue`. OpenInstinct: `agent/channels/linq.ts`, `agent/lib/linq/transport.ts`(하나의 모듈 뒤에 격리된 전송), `db/services/auth/linq.ts`와 `tests/linq.test.ts`, `tests/linq-delivery.test.ts`(전화번호 검증 및 전달 테스트). 폐기된 1차 이터레이션 `host-imessage-assistant/design.md`는 `git show e3c01d2:openspec/changes/host-imessage-assistant/design.md`로 읽음: 별도 워커를 쓰는 아웃박스, 확인 응답 전에 영속화되는 서명된 웹훅, 불확실한 발송 잠금, 한정된 시도 횟수 | 채널 형태와 발신자-principal 매핑, 전송 격리, 검증 및 전달 테스트 구조, 확인 응답 전 내구성 있는 웹훅과 불확실한 발송 처리 | 연동되지 않은 발신자를 위한 템플릿의 낯선 사람 세션(우리는 `null`을 반환하여 세션이 존재하지 않음), `@vercel/connect` 자격 증명(스파이크가 끝날 때까지 Photon Spectrum 프로젝트 자격 증명을 사용), 전송으로서의 Linq, 폐기된 서비스 발송 환영 메시지와 전화번호 제출 흐름 |
| 7 요청자 이메일 채널 | eve 메모리 템플릿: `agent/lib/integrations/slack/{channel,identity}.ts`와 그 테스트, `agent/lib/testing/slack.ts`(신원 확인과 테스트 도우미를 갖춘 사용자 정의 채널). eve 채팅 템플릿: `agent/channels/slack.ts`(최소 채널). OpenInstinct: Chat SDK Gmail 어댑터를 평가하는 경우에만 클라이언트 형태를 위한 `agent/lib/google-workspace/gmail.ts` | 사용자 정의 채널 구조, 모델 턴 밖에 두는 신원 확인, 채널 테스트 도우미 | Slack 자체, 도구로서의 Gmail, 신원으로 쓰이는 모든 발신자 주장 |
| 8 운영과 릴리스 | OpenInstinct: `agent/instrumentation/{otel,evlog}.ts`, `agent/hooks/evlog.ts`. eve 채팅 템플릿: `scripts/setup.sh`, `docs/setup-and-deploy.md`, `apps/web/lib/setup.ts`. personal-agent 템플릿: `.github/workflows/ci.yml`, `docs/ENVIRONMENT.md` | 비공개 텍스트가 없는 계측, 설정 및 준비도 스크립트, CI 구성, 환경 문서 구조 | 그들의 호스팅 전제와 제공자 목록 |

설계 참조도 같은 규칙을 따릅니다. [DESIGN.md](../../DESIGN.md)가 토큰, 타입, 간격, 컴포넌트 레시피를 소유합니다. 메시지와 작성기 상호작용은 Vercel chatbot과 AI Elements 스킬을 따릅니다. 1차 이터레이션의 [디자인 시스템](../transplant/en/design-system.md)은 Thyme 팔레트에 맞게 조정한 시그니처 패턴만 제공합니다. 업무 및 미팅 가능 시간대 트랙을 갖춘 주간 차트, 출처를 보여 주는 칩, 한 줄 후보, 긴 편집기의 고정 액션 바, 포커스가 복귀하는 오른쪽 상세 시트, 인라인 삭제 확인이 그것입니다. 차가운 청록 토큰과 Pretendard는 채택하지 않습니다.

[cal.diy](https://github.com/calcom/cal.diy)는 **설계 전용(design-only)** 참조입니다. 성숙한 스케줄링 화면이 어떻게 보이고 동작하는지를 보기 위해 읽고, 어떻게 만들어졌는지를 위해서는 절대 읽지 않습니다. 그 tRPC, Prisma, 모노레포, `packages/ui` 시스템, Cal 브랜드 토큰, 슬롯 예약, 이벤트 유형, 임베드는 채택하지 않습니다. 다음 화면을 살펴보고 Thyme 방향으로 다시 스타일링합니다.

| 우리의 화면 | 살펴볼 cal.diy 화면 | 가져올 것 |
|---|---|---|
| 3단계 후보 시간 카드와 시간대 카드(P08, P09) | `apps/web/modules/bookings/components/{Booker,EventMeta,DatePicker,AvailableTimes,AvailableTimesHeader,Unavailable}.tsx`, `packages/features/timezone/components/TimezoneSelectComponent.tsx`, `apps/web/app/(booking-page-wrapper)/[user]/[type]/page.tsx` | 선택지 옆에 소요 시간, 방식, 장소를 담은 미팅 요약; 시간 옆에 붙은 시간대 선택기; 12/24시간 전환; 날짜별 오프셋; 명시적인 이용 불가 상태. 우리 후보는 월간 격자가 아니라 대화 안의 짧은 순위 목록이므로, 캘린더 레이아웃이 아니라 정보 순서와 상태를 가져옵니다 |
| 4단계 영수증과 **예약 보기(View booking)** 목적지(예약 후 P09, `/app`의 선택된 요청) | `apps/web/modules/bookings/components/BookingSuccessCard.tsx`, `apps/web/modules/bookings/views/bookings-single-view.tsx`, `apps/web/app/(booking-page-wrapper)/booking-successful/[uid]/page.tsx` | 확정 배지, 시간대를 명시한 무엇/언제/누구/어디 블록, 참여 링크 위치, 차분한 단일 열 영수증. 첫 릴리스 범위 밖인 일정 변경과 취소 동작은 제외합니다 |
| 4단계 확인 이메일 | `packages/emails/src/templates/{Attendee,Organizer}ScheduledEmail.tsx`, `packages/emails/src/components/{BaseEmailHtml,EmailSchedulingBodyHeader,WhenInfo,WhoInfo,LocationInfo,CallToAction}.tsx` | [확인 설계](../user_experience/03_interfaces.md#booking-confirmation-email-and-calendar-invitation)에서 이미 선택한 표현: 블록 순서, 역할 라벨, 일반 텍스트 대체본. 우리의 발신자, Reply-To, 캘린더 파트 규칙은 [email-delivery 계약](../../openspec/specs/email-delivery/spec.md)을 따릅니다 |
| 2단계 주간 가능 시간대 미리보기와 편집기(P03) | `packages/features/schedules/components/{ScheduleComponent,DateOverrideList,DateOverrideInputDialog}.tsx`, `packages/platform/atoms/availability/AvailabilitySettings.tsx` | 시간 범위가 있는 요일 행, 다른 요일로 복사, 야간 구간을 위한 명확한 다음 날 처리. 우리 값은 **이대로 사용(Use this)**, **조정(Adjust)**, **직접 선택(Choose my own)**이 붙은 라벨이 있는 제안으로 도착하므로, 편집기는 첫 단계가 아니라 카드 뒤에 있는 정밀 편집 화면입니다 |
| 3단계 공개 호스트 페이지(P08) | `apps/web/app/(booking-page-wrapper)/[user]/page.tsx`, `apps/web/modules/bookings/components/EventMeta.tsx` | 호스트 신원 블록과 절제된 분량의 공개 정보. 우리는 에이전트 섹션과 스킬 문서 링크를 추가하고 이벤트 유형 목록은 보여 주지 않습니다 |

## 6. 1차 이터레이션 재사용

[이식 가이드](../transplant/en/transplant-guide.md)는 다른 스택의 프로토타입을 설명합니다. KST 전용 시간 처리, Drizzle, Ollama, 초대 전용 연락처 모델, 클라이언트 우선 순위 지정 규칙입니다. 그 코드는 복사하지 않습니다. 현재 문서가 이미 같은 동작을 요구하므로 다음 아이디어는 위의 단계들로 이어집니다.

- 캘린더 정규화 규칙: 취소, 거절, 투명이 아닌 한 바쁨; 제공자 식별자로만 사본을 병합; 종일 이벤트는 시간을 막지만 이동의 기준점이 되지 않음; 모호한 장소와 링크의 조합은 참석 방식을 결정하지 않음(2단계 분석, 3단계 실현 가능성).
- 재제출 대신 고정된 명령과 "결과 확인" 복구 경로를 쓰는 멱등 작업 훅(1단계 명령 파이프라인과 카드 동작).
- 원본이 바뀌면 "다시 확인 필요"를 보여 주는, 원본 지문이 있는 수정 사항(2단계 메모성 제외).
- "분석은 증거이며 정책이 아니다"라는 문구와 데이터가 적을 때의 메시지(2단계 제안).
- 검증되지 않은 수치를 모델이 작성하는 것이 아니라 코드가 계산한 근거로 생성되는 설명(3단계 후보 설명).

이어받지 않는 것: 이동 테이블 휴리스틱(버퍼를 갖춘 Google Routes로 대체), 상호 연락처 게이트(호스팅이 개방형임), 절대 차단하지 않는 보류 요청, 앱 내 전용 이벤트(우리는 Google Calendar에 기록함), 한국어 전용 UI.

## 7. 결정 기한

| 결정 | 최종 단계 | 갱신할 소유 문서 |
|---|---|---|
| eve 버전, 템플릿 리비전, 모델 ID, 의존성 고정 | 1단계 제안서 | 프런트엔드 아키텍처, 에이전트 구성 |
| 내구성 있는 작업 배치와 디스패처 소유권 | 1단계 종료 | 백엔드 아키텍처 |
| 가입 및 핸들 한도, 예약 핸들, 시작용 기본값 | 2단계 제안서 | PRD 10절, host-admission 명세 |
| 지원 지역, 경로 최신성, 수동 허용치 세분도(이동 수단은 2단계에서 확정됨) | 3단계 제안서(D1, D2) | PRD 이동 시간 확인, meeting-feasibility 명세 |
| 온라인 미팅 링크 생성 | 3단계 제안서(D6), 요청자 동의가 링크를 다루므로 4단계에서 옮겨 옴 | PRD 10절, meeting-requests 명세 |
| 연락처 확인, 요청 생성 한도, Cloudflare 설정, `evaluate_candidates` 배치, 예약 링크 저장, 로컬 메시징, 공개 페이지의 대화, 동의 전 인증, 하나로 이어진 게스트 스레드 | 3단계 제안서(D3–D5, D7–D12는 2026-10-21 결정; D13은 2026-10-22 결정) | meeting-requests, email-delivery, messaging-environments 명세; 제공자 설정; 에이전트 구성 |
| MCP 프로토콜 버전, 등록, 스코프, CLI 패키징 | 5단계 제안서 | 에이전트 클라이언트 인가 명세, CLI 방향 |
| iMessage 어댑터, 코드 만료, 회선 프로비저닝, 원탭 딥링크 | 6단계 제안서(D1–D14는 2026-10-23에 결정됨) | 제공자 설정, 새 iMessage 변경 |
| AgentMail 어댑터와 보존 | 7단계 제안서(D1–D11은 2026-10-22에 결정됨) | 제공자 설정 |
| 측정 목표, 보존 및 삭제, 지원 담당 | 8단계 제안서(D1–D14는 2026-10-23에 결정) | PRD 2절과 10절 |

## 8. 위험

| 위험 | 영향 | 완화 |
|---|---|---|
| eve 구성이 인가, 재연결, 재시작 검사를 충족하지 못함 | 런타임 선택이 뒤늦게 다시 열림 | 1단계가 한정된 증명이며, 대체는 조용한 두 번째 엔진이 아니라 명시적인 설계 결정임 |
| Calendar 스코프에 대한 Google 앱 검증이 느림 | 테스트 사용자 상한이 외부 호스트를 막음 | 2단계 중에 제출; 첫 외부 호스트 전에 릴리스 분리를 유지 |
| Photon 전달 가능성 또는 채널 모호성(SMS/RCS 대체) | iMessage 인수를 닫을 수 없음 | 수신 우선 연결 코드; 대체 사용을 기록; iMessage 통과를 주장하는 대신 롤아웃 게이트에서 중단 |
| 디스커버리와 MCP 지원이 서로 다른 일곱 개의 명명된 클라이언트 | AC-14, AC-15, AC-23, AC-24가 열린 채로 남음 | 5단계에서 정하는 클라이언트별 테스트 환경; 대체 수단으로 명시적인 `/SKILL.md` 붙여넣기 경로; 보편 호환성 주장은 하지 않음 |
| 불확실한 Calendar 쓰기 또는 제공자 타임아웃 | 중복 또는 유령 예약 | 디스패치 전 예약과 고정된 페이로드, 재시도 전 조정, 보류 상태를 사실대로 표시 |
| Docker가 없는 팀원 | 마이그레이션을 생성할 수 없음 | Docker를 갖춘 한 팀원이 같은 풀 리퀘스트 안에서 마이그레이션을 생성 |
| 요청자 텍스트, 이메일, 표시 이름을 통한 프롬프트 인젝션 | 비공개 데이터 또는 권한 유출 | 대상별로 도구 제외, 모델 컨텍스트 이전의 프로젝션, 3단계부터 `evals/`의 evals |

## 9. 각 변경의 완료 정의

- 작성자가 아닌 팀원이 제안서, 델타 명세, 작업 목록을 검토함.
- 풀 리퀘스트가 따른 참조 저장소 파일과 리비전을 명시하며, 복사한 코드는 상위 프로젝트의 라이선스 고지를 유지함.
- 다룬 동작에 대해, 모듈 옆의 단위 테스트, `tests/integration/` 아래의 통합 테스트, `tests/e2e/` 아래의 브라우저 여정, `supabase/tests/` 아래의 데이터베이스 grant 및 동시성 테스트가 있고, `npm run check`와 앱 빌드, 린트, 타입 검사, 테스트 명령이 CI에서 통과함.
- 같은 풀 리퀘스트에서 문서가 갱신됨: 소유하는 제품, UX, 기술, 제공자 문서, 새 변수를 위한 `.env.example`, 변경된 영어 문서에 대해 다시 생성한 한국어 미러.
- 변경이 다룬 인수 시나리오는 첨부된 증거와 함께 닫히거나 아직 보류 중임이 명시적으로 나열됨.
- 자리표시자 메모, 건너뛴 테스트, 구현되지 않은 분기가 남아 있지 않음.
- 검증 후 `openspec archive`로 변경을 보관하고 주 명세를 동기화함.
