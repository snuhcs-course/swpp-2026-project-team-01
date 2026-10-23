# Find Me a Time — Iteration 2

외부 일대일 미팅을 대신 조율하는 AI 일정 에이전트 **Thyme**입니다. 호스트는 Google 로그인 후 웹 채팅이나 iMessage에서 Thyme과 함께 미팅 규칙을 정하고, 요청자는 계정 없이 공개 링크·이메일로 시간을 요청합니다. 예약은 호스트가 현재 제안을 명시적으로 승인해야 확정됩니다.

## 목차

- [Demo 영상](#demo-영상)
- [데모 범위](#데모-범위)
- [Iteration 2에서 달라진 점](#iteration-2에서-달라진-점)
- [기술 스택](#기술-스택)
- [배포된 서비스](#배포된-서비스)
- [준비사항](#준비사항)
- [로컬 실행 방법](#로컬-실행-방법)
- [iMessage·Google 실연결 (영상 재현)](#imessagegoogle-실연결-영상-재현)
- [테스트 (Checks)](#checks)
- [예상되는 오류와 해결 방법](#예상되는-오류와-해결-방법)

## Demo 영상

_녹화 후 `demos/iteration-2-demo.mov`로 추가합니다._

이 브랜치는 `main`의 `873804b`에 Iteration 2 마지막에 열려 있던 PR들을 합친 것입니다.

| PR | 내용 |
|---|---|
| [#36](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/36) | 운영과 릴리스 (Phase 8) |
| [#37](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/37) | 게스트 Google 동의 수정 |
| [#38](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/38) | Windows 로컬 개발 수정 |
| [#39](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/39) | iMessage 연결 화면과 iMessage에서의 설정 |

PR 외의 변경은 #36이 요구하는 `/privacy` 링크를 새 랜딩 푸터에 넣은 것 하나뿐입니다. 영상은 아래 **로컬 실행**에 실제 iMessage와 Google 연결을 더해 녹화했습니다.

## 데모 범위

데모 영상에는 다음 흐름이 들어갑니다.

1. **두 가지 시작.** `/`는 Google로 시작하고, 캘린더 체크박스로 캘린더를 지금 연결할지 정합니다. `/?flow=imessage`는 계정이 생기기 전에 **Onboard with iMessage**로 시작합니다. 두 화면 모두 영어와 한국어를 지원합니다.
2. **메시지 하나로 iMessage 연결.** 휴대폰에서는 **Open Messages**가 메시지가 이미 적힌 채로 메시지 앱을 엽니다. 컴퓨터에서는 팝업이 QR 코드, **Open Messages on this Mac**, **Copy**를 제공합니다. 메시지가 도착하면 페이지가 스스로 바뀌고, 호스트가 마스킹된 발신자를 확인(**Is this you?**)해야 연결됩니다.
3. **iMessage에서 이어지는 설정.** iMessage 시작에 대한 Thyme의 답장에는 로그인 링크가 들어 있습니다. **Confirm and link** 후 Thyme이 iMessage에서 인사하고, 캘린더가 없으면 Google Calendar 연결 링크를, 있으면 첫 설정 질문을 보냅니다. 답장하면 웹과 같은 설정 대화가 이어집니다.

이 브랜치에는 영상 밖의 기능도 함께 구현되어 있습니다.

- 캘린더를 분석해 값을 제안하는 호스트 설정
- 공개 호스트 페이지
- 채팅 스레드 안의 게스트 요청
- 호스트 검토·승인과 Calendar 일정 생성까지의 예약
- 요청자 이메일 채널
- MCP를 통한 에이전트 접근
- `/privacy` 안내와 운영자 진단 CLI

## Iteration 2에서 달라진 점

Iteration 1의 prototype(Drizzle, 앱 자체 Google OAuth, Ollama)을 2026-10-19부터 새 구조로 다시 만들었습니다. Iteration 2에서 합친 단계는 다음과 같습니다.

| 단계 | PR | 추가된 것 |
|---|---|---|
| 1 애플리케이션 기반 | #19 | Supabase Auth의 Google 로그인, `/app` 작업 공간, 스키마 기준선, 명령 파이프라인과 작업 |
| 2 호스트 온보딩 | #22 | 제안 우선 설정, 공개 호스트 페이지와 스킬 문서, 핸들, 관리자 CLI |
| 3 요청자 접수와 실현 가능성 | #26, #27, #28 | 게스트 요청 스레드, 실현 가능성 판단, 요청자 Google 권한 |
| 4 호스트 검토와 예약 | #30, #32 | 호스트 검토, 명시적 승인, Calendar 일정을 만드는 예약 |
| 5 에이전트 접근 | #33 | 인가 서버, MCP 서버, CLI, 요청자 부트스트랩 |
| 6 호스트 iMessage 채널 | #35, #39 | Photon 수신기·발신함·명령, 연결 화면, iMessage 시작, iMessage에서의 설정 |
| 7 요청자 이메일 채널 | #34 | 이메일로 하는 요청과 답장 |
| 8 운영과 릴리스 | #36 | 진단, 복구, 보존과 삭제, 개인정보 안내, 릴리스 워크플로 |

## 기술 스택

| 영역 | 기술 |
|---|---|
| 웹 UI / 서버 API | Next.js 16 App Router, React 19, TypeScript |
| 스타일 | Tailwind CSS 4 |
| 에이전트 | eve 0.80 (Vercel), OpenAI `gpt-5.6-terra` |
| 데이터베이스 / 로그인 | Supabase Postgres와 Auth, postgres.js, pg-delta 선언형 스키마 |
| Calendar | Google OAuth 2.0, Google Calendar API |
| iMessage | Photon Spectrum (`@spectrum-ts` 12.14.0) |
| 이메일 | AgentMail |
| 테스트 | Vitest, Playwright, pgTAP |
| 웹 호스팅 | Vercel |

## 배포된 서비스

[https://findmeatime.com](https://findmeatime.com)에 운영 배포가 있습니다. 다만 2026-10-23 기준 운영 배포는 Phase 6(iMessage) 이전 버전입니다(#36 기록). 이 브랜치의 iMessage 흐름은 아래 로컬 실행으로 확인합니다.

## 준비사항

- Node.js 24와 npm. 영상은 Node.js 25.9.0으로 녹화했습니다.
- Docker Desktop과 Supabase CLI **2.119.0** (`supabase --version`으로 확인)
- OpenAI API 키. 에이전트 대화에 쓰며, 비용이 발생합니다.
- Google Cloud 프로젝트의 OAuth 클라이언트. Calendar API를 켜고, redirect URI에 `http://127.0.0.1:54321/auth/v1/callback`을 등록합니다.
- (iMessage 실연결 시) Photon Spectrum 프로젝트와 회선 하나, iPhone, Mac의 메시지 앱(같은 Apple ID)

```bash
git clone --branch iteration-2-demo https://github.com/snuhcs-course/swpp-2026-project-team-01.git
cd swpp-2026-project-team-01
npm ci
cp .env.example .env
```

## 로컬 실행 방법

1. Docker를 실행하고 로컬 Supabase를 시작합니다. `db reset --local`은 기존 로컬 데이터를 지웁니다.

```bash
supabase start
supabase db reset --local
supabase status
```

2. `.env`에 아래 값을 채우고, `supabase status`의 로컬 값(URL, 키, DB URL)은 `.env.local`에 넣습니다. 각 변수의 설명은 `.env.example`에 있습니다. `TOKEN_ENCRYPTION_KEY`는 `openssl rand -base64 32`로, 서명 키들은 서로 다른 임의 값으로 만듭니다. `.env`와 모든 키는 Git에 올리지 않습니다.

```dotenv
OPENAI_API_KEY=<OPENAI_API_KEY>
GOOGLE_CLIENT_ID=<GOOGLE_OAUTH_CLIENT_ID>
GOOGLE_CLIENT_SECRET=<GOOGLE_OAUTH_CLIENT_SECRET>
APP_ORIGIN=http://localhost:3000
TOKEN_ENCRYPTION_KEY=<base64 32바이트>
EVE_INTERNAL_SIGNING_KEY=<임의 값>
AGENT_TOKEN_SIGNING_KEY=<임의 값>
PHOTON_LINE_NUMBER=<Photon 회선 번호, 예: +15550001111>
```

3. 웹·에이전트와 작업 처리기를 각각 다른 터미널에서 실행합니다. 둘 다 공유·릴리스 Supabase 프로젝트를 가리키면 실행을 거부합니다.

```bash
npm run dev       # 웹 :3000, 에이전트 :2000
npm run jobs:dev  # iMessage 수신·발송 등 작업 처리
```

4. [http://localhost:3000](http://localhost:3000)(Google 먼저) 또는 [http://localhost:3000/?flow=imessage](http://localhost:3000/?flow=imessage)(iMessage 먼저)를 엽니다.
   - Google로 로그인하면 `/app`이 "Thyme에게 메시지 하나 보내기" 단계를 보여 줍니다. **Set up here in web chat**으로 건너뛰면 웹 채팅에서 설정합니다.
   - 설정을 확정하면 공개 링크(`/{handle}`)가 생깁니다. 다른 브라우저에서 그 링크로 요청을 보내고, 호스트가 `/app`에서 승인하면 예약됩니다.

## iMessage·Google 실연결 (영상 재현)

메시지 발송은 설계상 운영 환경에서만 허용됩니다. 로컬 실행은 `PHOTON_API_URL`의 로컬 스탠드인으로만 보내므로, 실제 iPhone으로 영상을 재현하려면 발표자 컴퓨터에서만 다음을 준비합니다. 이 설정은 커밋하지 않습니다.

- **수신:** 에이전트의 `/photon/webhook`(:2000)을 HTTPS 터널(예: Cloudflare quick tunnel)로 노출합니다. 그 주소를 Photon 프로젝트의 웹훅으로 등록하고, `PHOTON_WEBHOOK_ID`와 `PHOTON_WEBHOOK_SECRET`을 설정합니다.
- **발송:** `PHOTON_API_URL`을 발표자 번호로만 Photon에 전달하는 로컬 스탠드인으로 지정합니다. `PHOTON_PROJECT_ID`와 `PHOTON_PROJECT_SECRET`은 그 스탠드인이 씁니다.
- **Google 로그인:** 위 OAuth redirect URI가 등록되어 있어야 합니다. 휴대폰은 로컬 콜백에 닿을 수 없으므로, 웹 단계는 Mac 브라우저에서 진행하고 iPhone은 메시지 앱에만 씁니다.

영상의 순서는 다음과 같습니다.

1. Mac에서 `/?flow=imessage`를 열고 팝업의 QR을 iPhone으로 찍어 메시지를 보냅니다.
2. 화면이 받음 상태로 바뀌면 Google로 로그인하고 **Confirm and link**를 누릅니다.
3. iPhone에서 Thyme의 인사에 답하며 설정을 이어갑니다.

## Checks

```bash
npm run lint
npm run typecheck
npm test                       # 단위 테스트
npm run build
npm run test:integration       # 로컬 Supabase 필요
npx playwright install chromium
npm run test:e2e               # 로컬 Supabase 필요
supabase test db               # pgTAP, 새로 reset한 DB에서
npm run check:docs
```

통합·E2E 테스트는 OpenAI, Google, Photon, AgentMail 대신 로컬 스탠드인을 사용하므로 키 없이 실행됩니다. 테스트 방법과 결과는 Wiki의 Testing Documentation에 정리합니다.

## 예상되는 오류와 해결 방법

- `redirect_uri_mismatch`: Google Console의 OAuth 클라이언트에 `http://127.0.0.1:54321/auth/v1/callback`이 등록되어 있는지 확인합니다. 환경 변수를 바꾸면 `supabase stop` 후 `supabase start`로 Auth를 다시 띄웁니다.
- 로그인 후 `/app`이 비어 있거나 `setup_session_unavailable`: 에이전트(`:2000`)가 실행 중인지 확인합니다(`npm run dev`가 함께 띄웁니다).
- iMessage 화면이 받음으로 바뀌지 않음: 다음 세 가지를 확인합니다.
  - `npm run jobs:dev`가 실행 중인지
  - 터널 주소가 Photon 웹훅과 같은지
  - `PHOTON_WEBHOOK_SECRET`이 맞는지
- `supabase test db`의 `agent_clients_pkey` 중복 오류: 통합 테스트가 남긴 행 때문입니다. `supabase db reset --local` 후 다시 실행합니다.
- `npm run jobs:dev` 또는 `npm run dev`가 실행을 거부: `.env`가 공유·릴리스 프로젝트를 가리키고 있습니다. 로컬 스택 값으로 바꿉니다.
- E2E 브라우저 오류: `npx playwright install chromium`을 한 번 실행합니다.

참고: [제공자 설정](documentations/technical_specification/03_provider_setup.md), [문서 목록](documentations/README.md), [Supabase 로컬 개발](https://supabase.com/docs/guides/local-development), [Photon 웹훅](https://photon.codes/docs/webhooks/overview).
