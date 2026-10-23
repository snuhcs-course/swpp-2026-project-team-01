# Find Me a Time

> 한국어 번역본 (검토용). 원본: README.md

외부 일대일 미팅을 위한 AI 일정 조율 에이전트입니다. **Thyme**은 시간을 협상하며, 예약은 호스트가 현재 제안을 명시적으로 승인해야 확정됩니다.

도메인: [findmeatime.com](https://findmeatime.com) · SNU SWPP 프로젝트 팀 01

## Iteration 2 데모

이 브랜치 `iteration-2-demo`는 `873804b` 시점의 `main`에 Iteration 2 마지막에 열려 있던 풀 리퀘스트를 더한 것입니다: [#36](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/36)(운영과 릴리스), [#37](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/37)(게스트 Google 동의), [#38](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/38)(Windows 로컬 개발), [#39](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/39)(iMessage 연결 화면과 iMessage에서의 설정). 이 풀 리퀘스트들 외의 변경은 새 랜딩 푸터의 `/privacy` 링크 하나뿐이며, #36이 이를 요구합니다.

**데모 영상:** _녹화 후 링크를 추가합니다._

### 데모가 보여 주는 것

1. **두 가지 시작.**
   - `/`는 Google로 시작하며, 캘린더 체크박스로 캘린더를 지금 연결할지 정합니다.
   - `/?flow=imessage`는 계정이 생기기 전에 **Onboard with iMessage**로 시작합니다.
   - 두 페이지 모두 영어와 한국어로 동작합니다.
2. **메시지 하나를 보내 iMessage 연결.**
   - 휴대폰에서는 **Open Messages**가 메시지가 이미 쓰인 채로 메시지 앱을 엽니다.
   - 컴퓨터에서는 팝업이 QR 코드, **Open Messages on this Mac**, **Copy**를 제공합니다.
   - 메시지가 도착하면 페이지가 스스로 바뀌고, 무엇이든 연결되기 전에 호스트가 마스킹된 발신자를 확인합니다(**Is this you?**).
3. **iMessage에서의 설정.**
   - iMessage 시작에 대한 Thyme의 답장에는 로그인 링크가 담깁니다.
   - **Confirm and link** 후 Thyme은 iMessage에서 호스트를 맞이하며, Google 캘린더 링크를 보내거나 첫 설정 질문을 합니다.
   - 평문 답장은 웹에서 보이는 것과 같은 설정 대화를 이어갑니다.
4. **같은 빌드에서 동작하는 나머지 제품:**
   - Google 캘린더 기반의 제안 우선 호스트 설정;
   - 공개 호스트 페이지;
   - 채팅 스레드 안의 게스트 요청(양식에서의 Google 동의 포함, #37);
   - 호스트 검토와 승인;
   - 예약;
   - 요청자 이메일 채널;
   - MCP를 통한 에이전트 접근;
   - `/privacy` 안내와 운영자 진단(#36).

### Iteration 2의 주요 진행

| 단계 | 풀 리퀘스트 | 추가한 것 |
|---|---|---|
| 1 애플리케이션 기반 | #19 | Google 로그인, `/app` 작업 공간, Supabase 스키마 기준선, 명령 파이프라인과 작업 |
| 2 호스트 온보딩 | #22 | 제안 우선 설정, 공개 호스트 페이지와 스킬 문서, 핸들, 관리자 CLI |
| 3 요청자 접수와 실현 가능성 | #26, #27, #28 | 게스트의 요청 스레드, 실현 가능성, 요청자 Google 권한 |
| 4 호스트 검토와 예약 | #30, #32 | 호스트 검토, 명시적 승인, 캘린더 일정을 만드는 예약 |
| 5 에이전트 접근 | #33 | 인가 서버, MCP 서버, CLI, 요청자 부트스트랩 |
| 6 호스트 iMessage 채널 | #35, #39 | Photon 수신기, 발신함, 명령; 연결 화면, iMessage 시작, iMessage에서의 설정 |
| 7 요청자 이메일 채널 | #34 | 이메일로 하는 요청과 답장 |
| 8 운영과 릴리스 | #36 | 진단, 복구, 보존과 삭제, 개인정보 안내, 릴리스 워크플로 |

### 데모에 사용한 환경

- Apple silicon의 macOS 26.6.2, Node.js 25.9.0(팀 기준은 Node.js 24)과 npm.
- Docker Desktop, Supabase CLI 2.119.0, 로컬 Supabase 스택.
- Mac의 Chrome. Mac의 메시지 앱과 같은 Apple ID로 iMessage를 쓰는 iPhone.
- 회선 하나가 있는 Photon Spectrum 프로젝트 하나와 OpenAI API 키(에이전트가 비용을 씁니다).

### 실행 방법

1. 설치하고 로컬 스택을 시작합니다:

   ```sh
   npm ci
   supabase start
   supabase db reset --local
   ```

2. `.env.example`로 `.env`를 채우고, 로컬 스택의 값(`supabase status`)을 `.env.local`에 넣습니다. 데모에 필요한 값:
   - `OPENAI_API_KEY`
   - `GOOGLE_CLIENT_ID`와 `GOOGLE_CLIENT_SECRET`
   - `TOKEN_ENCRYPTION_KEY`, `EVE_INTERNAL_SIGNING_KEY`, `AGENT_TOKEN_SIGNING_KEY`
   - `APP_ORIGIN=http://localhost:3000`
   - `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`, `PHOTON_LINE_NUMBER`, `PHOTON_WEBHOOK_ID`, `PHOTON_WEBHOOK_SECRET`

3. 서비스를 각각 다른 터미널에서 실행합니다:

   ```sh
   npm run dev       # 웹 :3000, 에이전트 :2000 (/photon/webhook 제공)
   npm run jobs:dev  # 수신, 발송 등의 작업
   ```

4. `http://localhost:3000`(Google 먼저) 또는 `http://localhost:3000/?flow=imessage`(iMessage 먼저)를 엽니다.

실제 iMessage와 Google 데모에만 필요한 단계로, 발표자의 컴퓨터에서 하며 커밋하지 않습니다:

- **iMessage 수신.**
  - 에이전트의 `/photon/webhook`을 HTTPS로 노출합니다(예: Cloudflare 빠른 터널).
  - 그 URL을 Photon 프로젝트의 웹훅으로 등록한 뒤 `PHOTON_WEBHOOK_ID`와 `PHOTON_WEBHOOK_SECRET`을 설정합니다.
- **iMessage 발송.** 메시지 발송은 설계상 프로덕션에서만 허용되므로, 로컬 실행은 `PHOTON_API_URL`의 루프백 스탠드인으로만 보냅니다. 데모에서는 그 스탠드인이 발표자 본인의 번호에 한해서만 Photon으로 전달합니다.
- **Google 로그인.** Google이 로컬 Auth 콜백 `http://127.0.0.1:54321/auth/v1/callback`을 받아들여야 합니다([제공자 설정](documentations/technical_specification/03_provider_setup.md#google-identity-and-calendar) 참조). 휴대폰은 로컬 콜백에 닿을 수 없으므로 웹 단계는 Mac에서 하고 iPhone은 메시지 앱에만 씁니다.

Photon, Google, OpenAI 없이도 [검사](#검사) 아래의 검사들은 테스트가 쓰는 스탠드인을 상대로 실행됩니다.

## 상태

**이 브랜치에는 Phase 1부터 8까지 구현되어 있습니다**([Iteration 2 데모](#iteration-2-데모) 참조). 이 문단의 나머지는 Iteration 2 마지막 풀 리퀘스트 이전의 상태를 설명합니다. 제품 방향, 사용자 경험, 아키텍처, 제공자 설정, 시각 디자인, 기능 명세는 이 저장소에서 합의되었습니다. [`application-foundation`](openspec/changes/application-foundation/proposal.md) 변경이 Google 로그인, `/app` 작업 공간, 플랫폼 메커니즘을 만들었고, [`host-onboarding`](openspec/changes/host-onboarding/proposal.md)이 제안 우선 호스트 설정, 공개 호스트 페이지와 스킬 문서, 관리자 CLI를 추가했습니다. 두 변경 모두 `findmeatime.com`과 `release.findmeatime.com`에 배포되어 있으며, 그 증거와 열린 공백은 [인수 기록](documentations/technical_specification/07_acceptance_record.md)에 있습니다. 요청자 접수와 예약은 이후 단계에서 들어옵니다.

먼저 [원페이저](documentations/01_one_pager.md)와 [PRD](documentations/02_product_requirements.md)를 읽으십시오. [문서 색인](documentations/README.md)에서 모든 문서를 볼 수 있습니다.

공유 Supabase 프로젝트는 **`anelszynxtvxoxqvzgqt`**(**FindMeATime**, `us-east-2`)입니다. 팀원은 개인 Supabase 프로젝트와 로컬 `eve dev`에서 개발합니다. 공유 프로젝트는 CI를 통해 `main`을 따라가며, 첫 외부 사용자 전에 릴리스 환경을 분리합니다. [환경과 협업](documentations/technical_specification/03_provider_setup.md#environments-and-collaboration)을 참고하십시오.

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `agent/` | eve 에이전트 정의, 지침, 채널 |
| `apps/web/` | Next.js 웹 앱: `/`의 공개 진입점, `/app`의 대화 |
| `lib/` | 에이전트와 웹 앱이 공유하는 계약과 서버 코드 |
| `tests/` | 통합 테스트와 브라우저 테스트. 단위 테스트는 각 모듈 옆에 있음 |
| `documentations/` | 제품 방향, UX, 아키텍처, 제공자 설정 |
| `DESIGN.md` | Thyme 시각 방향과 브랜드 자산 |
| `openspec/specs/` | 합의된 기능 동작. 구현이 충족해야 하는 계약 |
| `openspec/changes/` | 대기 중인 변경 제안. 완료된 변경은 검증 후 여기에 보관 |
| `supabase/` | 로컬 Supabase 설정, 원하는 스키마, 검토를 마친 마이그레이션 체인, 데이터베이스 테스트 |
| `ai-usage/` | 과정에서 요구하는 브랜치별 AI 토큰 및 에이전트 시간 기록 |
| `.agents/skills/` | 공유 프로젝트 워크플로와 참고 자료 |

## 검토 대기 문서

이 문서들은 반복 1 프로토타입에서 변경 없이 복사되었습니다. 팀이 위 문서들에 맞추어 검토하고 갱신할 수 있도록 두었습니다.

- [이식 가이드](documentations/transplant/en/transplant-guide.md): 프로토타입의 기능 F01–F11, 사용자 여정, 재사용을 위해 분해한 디자인.
- [AI 사용 기록](ai-usage/README.md): 훅 설정은 [에이전트 지침](AGENTS.md#ai-usage-records)을 참고하십시오.

## 검사

Node.js 24와 OpenSpec CLI **1.14.0**을 사용합니다. 링크 검사기는 의존성을 설치하지 않고 실행됩니다.

```sh
npm run check:docs
openspec validate --all --strict
```

`npm ci`로 애플리케이션을 설치한 뒤, CI가 실행하는 검사를 실행하십시오.

```sh
npm run build
npm run lint
npm run typecheck
npm test
```

`npm run test:integration`은 통합 테스트를, `npm run test:e2e`는 Playwright 브라우저 테스트를 실행합니다(브라우저는 `npx playwright install chromium`으로 한 번 설치). 둘 다 `supabase start`의 로컬 스택이 필요하며 OpenAI를 호출하지 않습니다. 예외는 선택 실행인 `E2E_LIVE_MODEL=1 npm run test:e2e`로, 로그인부터 첫 답장까지의 여정을 실제 모델로 실행합니다. `npm run dev`는 루트 `.env`와 `.env.local` 재정의로 웹 서비스와 에이전트 서비스를 실행합니다. 운영자는 `npm run admin -- <show|suspend|restore> --host <handle-or-id> --operator <name> (--local | --project <ref>)`로 호스트를 정지, 복원, 조회하며, 이 `fmat-admin` CLI는 [CLI 방향](documentations/technical_specification/05_cli.md#administrator-cli)에 설명되어 있습니다. Supabase CLI **2.119.0**이 팀 버전입니다. 스키마 생성, 데이터베이스 리셋, 배포는 [에이전트 지침](AGENTS.md#supabase-schema-changes)을 따릅니다.
