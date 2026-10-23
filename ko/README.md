# Find Me a Time — Iteration 2

# Find Me a Time — Iteration 2

**Thyme**은 외부 상대와의 일대일 미팅을 위한 AI 일정 조율 에이전트입니다. 호스트는 Google로 로그인하고 웹 채팅이나 iMessage에서 Thyme과 미팅 규칙을 설정합니다. 요청자는 계정 없이 공개 링크나 이메일로 시간을 요청합니다. 호스트가 현재 제안을 명시적으로 승인해야만 예약됩니다.

## 목차

- [데모 영상](#데모-영상)
- [데모 범위](#데모-범위)
- [Iteration 2의 변경 사항](#iteration-2의-변경-사항)
- [기술 스택](#기술-스택)
- [배포된 서비스](#배포된-서비스)
- [준비 사항](#준비-사항)
- [로컬 실행](#로컬-실행)
- [실제 iMessage와 Google 연결 (영상 재현)](#실제-imessage와-google-연결-영상-재현)
- [검증](#검증)
- [예상 오류와 해결 방법](#예상-오류와-해결-방법)

## 데모 영상

[Iteration 2 데모 보기 / 다운로드](../demos/iteration-2-demo.mp4) (MP4, 약 5 MB, 3분 24초; 1080p, 음성 없음).

저장소에서 재생할 수 있도록 원본 4K MOV를 압축했으며, 녹화 전체 내용을 유지했습니다.

이 브랜치는 `main`의 `873804b`에 Iteration 2 종료 시점에 열려 있던 다음 PR을 합친 것입니다.

| PR | 내용 |
|---|---|
| [#36](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/36) | 운영 및 릴리스 (Phase 8) |
| [#37](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/37) | 게스트 Google 동의 수정 |
| [#38](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/38) | Windows 로컬 개발 수정 |
| [#39](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/39) | iMessage 연결 화면 및 iMessage에서 설정 진행 |

이 PR들 외의 애플리케이션 변경은 #36에서 요구하는 새 랜딩 푸터의 `/privacy` 링크뿐입니다. 이 브랜치에는 데모 녹화와 제출 문서도 포함되어 있습니다. 영상은 아래 **로컬 실행**에 실제 iMessage와 Google을 연결해 녹화했습니다.

## 데모 범위

녹화에는 iMessage부터 시작하는 흐름, 즉 데스크톱 연결 팝업, Google 로그인과 Calendar 선택, iMessage에서 설정 질문에 답하는 과정이 담겨 있습니다. 브랜치는 다음 진입 및 설정 경로를 지원하며, 영상이 모든 변형을 시연하는 것은 아닙니다.

1. **두 가지 시작 경로.**
   - `/`에서는 Google로 시작하며 Calendar 체크박스로 즉시 Calendar를 연결할지 정합니다.
   - `/?flow=imessage`에서는 계정 생성 전 **Onboard with iMessage**로 시작합니다.
   - 두 페이지 모두 영어와 한국어를 지원합니다.
2. **메시지 한 번으로 iMessage 연결.**
   - 휴대전화에서 **Open Messages**를 누르면 메시지가 미리 작성된 상태로 Messages가 열립니다.
   - 컴퓨터에서는 QR 코드, **Open Messages on this Mac**, **Copy**를 제공하는 팝업이 나타납니다.
   - 메시지가 도착하면 페이지가 자동으로 바뀝니다. 호스트가 마스킹된 발신자 정보(**Is this you?**)를 확인하기 전에는 연결되지 않습니다.
3. **iMessage에서 이어지는 설정.**
   - iMessage 시작 메시지에 대한 Thyme의 답장에는 로그인 링크가 포함됩니다.
   - **Confirm and link** 이후 Thyme이 iMessage로 인사합니다. Calendar가 연결되지 않았다면 연결 링크를, 연결되어 있다면 첫 설정 질문을 보냅니다.
   - 답장은 웹에 표시되는 것과 동일한 설정 대화로 이어집니다.

이 브랜치에는 영상에 나오지 않는 다음 기능도 구현되어 있습니다.

- 호스트의 Calendar에서 값을 제안하는 호스트 설정
- 공개 호스트 페이지
- 채팅 스레드에서 진행하는 게스트 요청
- 호스트 검토와 승인, Calendar 이벤트 생성까지 이어지는 예약
- 요청자 이메일 채널
- MCP를 통한 에이전트 접근
- `/privacy` 안내와 운영자 진단 CLI

## Iteration 2의 변경 사항

Iteration 1 프로토타입(Drizzle, 앱 자체 Google OAuth, Ollama)을 2026-10-19부터 새 아키텍처로 재구축했습니다. 이 데모 브랜치에 포함된 단계는 다음과 같습니다(위에서 설명한 열린 PR 포함).

| 단계 | PR | 추가된 내용 |
|---|---|---|
| 1 애플리케이션 기반 | #19 | Supabase Auth를 통한 Google 로그인, `/app` 작업 공간, 스키마 기반, 명령 파이프라인과 작업 |
| 2 호스트 온보딩 | #22 | 제안 우선 설정, 공개 호스트 페이지와 스킬 문서, 핸들, 관리자 CLI |
| 3 요청 접수와 가능 여부 판단 | #26, #27, #28 | 게스트 요청 스레드, 가능 여부 확인, 요청자 Google 권한 |
| 4 호스트 검토와 예약 | #30, #32 | 호스트 검토, 명시적 승인, Calendar 이벤트를 생성하는 예약 |
| 5 에이전트 접근 | #33 | 인가 서버, MCP 서버, CLI, 요청자 초기 설정 |
| 6 호스트 iMessage 채널 | #35, #39 | Photon 수신기, 발신 큐와 명령, 연결 화면, iMessage 시작과 설정 |
| 7 요청자 이메일 채널 | #34 | 이메일을 통한 요청과 답장 |
| 8 운영 및 릴리스 | #36 | 진단, 복구, 보존과 삭제, 개인정보 안내, 릴리스 워크플로 |

## 기술 스택

| 영역 | 기술 |
|---|---|
| 웹 UI / 서버 API | Next.js 16 App Router, React 19, TypeScript |
| 스타일 | Tailwind CSS 4 |
| 에이전트 | eve 0.80 (Vercel), OpenAI `gpt-5.6-terra` |
| 데이터베이스 / 로그인 | Supabase Postgres와 Auth, postgres.js, pg-delta 선언적 스키마 |
| 캘린더 | Google OAuth 2.0, Google Calendar API |
| iMessage | Photon Spectrum (`@spectrum-ts` 12.14.0) |
| 이메일 | AgentMail |
| 테스트 | Vitest, Playwright, pgTAP |
| 웹 호스팅 | Vercel |

## 배포된 서비스

프로덕션 배포 주소는 [https://findmeatime.com](https://findmeatime.com)입니다. #36에 기록된 대로 2026-10-23 기준 Phase 6(iMessage) 이전 버전이므로, 이 브랜치의 iMessage 흐름은 아래 로컬 실행으로 시연합니다.

## 준비 사항

- Node.js 24와 npm. 영상은 Node.js 25.9.0에서 녹화했습니다.
- Docker Desktop과 Supabase CLI **2.119.0** (`supabase --version`으로 확인).
- 에이전트 대화에 사용할 OpenAI API 키. 사용 요금이 발생합니다.
- Calendar API가 활성화된 Google Cloud 프로젝트의 Google OAuth **Web application** 클라이언트. 호스트 로그인용 `http://127.0.0.1:54321/auth/v1/callback`과 요청자 동의용 `http://localhost:3000/connections/google/callback`을 등록합니다. 동의 화면이 Testing 상태라면 사용할 계정을 테스트 사용자로 추가합니다.
- [`lib/contracts/google-scopes.ts`](../lib/contracts/google-scopes.ts)에 나열된 호스트 Calendar scope를 설정합니다: `calendar.calendarlist.readonly`, `calendar.events`, `calendar.events.freebusy` (각각 앞에 `https://www.googleapis.com/auth/`를 붙임). 요청자 동의에는 `calendar.events.readonly`도 사용합니다.
- 실제 iMessage: 회선 하나가 있는 Photon Spectrum 프로젝트, iPhone, 같은 Apple ID를 사용하는 Mac의 Messages.

```bash
git clone --branch iteration-2-demo https://github.com/snuhcs-course/swpp-2026-project-team-01.git
cd swpp-2026-project-team-01
npm ci
cp .env.example .env
```

## 로컬 실행

1. Supabase를 시작하기 **전에** `.env`를 채웁니다. Google provider가 시작 시 `GOOGLE_CLIENT_ID`와 `GOOGLE_CLIENT_SECRET`을 읽습니다. `.env.example`의 로컬 Auth URL을 유지합니다. `.env`와 키는 커밋하지 않습니다.

```dotenv
OPENAI_API_KEY=<OPENAI_API_KEY>
GOOGLE_CLIENT_ID=<GOOGLE_OAUTH_CLIENT_ID>
GOOGLE_CLIENT_SECRET=<GOOGLE_OAUTH_CLIENT_SECRET>
APP_ORIGIN=http://localhost:3000
TOKEN_ENCRYPTION_KEY=<32 bytes, base64>
EVE_INTERNAL_SIGNING_KEY=<at least 32 characters>
AGENT_TOKEN_SIGNING_KEY=<base64 PKCS#8 Ed25519 private key>
PHOTON_LINE_NUMBER=<the Photon line's number, such as +15550001111>
```

키를 각각 생성하고 출력을 해당 변수에 복사합니다. `AGENT_TOKEN_SIGNING_KEY`는 MCP 에이전트 접근용이며 영상의 온보딩 흐름에는 필요하지 않습니다.

```bash
openssl rand -base64 32                         # TOKEN_ENCRYPTION_KEY
openssl rand -base64 48                         # EVE_INTERNAL_SIGNING_KEY
openssl genpkey -algorithm ed25519 -outform DER | openssl base64 -A  # AGENT_TOKEN_SIGNING_KEY
```

2. Docker와 로컬 Supabase 스택을 시작합니다. `db reset --local`은 기존 로컬 데이터를 삭제합니다.

```bash
supabase start
supabase db reset --local
supabase status
```

`supabase status`에서 확인한 로컬 스택 값을 `.env.local`에 넣습니다.

```dotenv
SUPABASE_PROJECT_REF=
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=<local publishable key>
SUPABASE_SECRET_KEY=<local secret key>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

실제 출력된 URL과 키가 다르면 해당 값을 사용합니다. 나머지 선택적 provider 설정은 `.env.example`에 설명되어 있습니다.

3. 웹·에이전트 서비스와 작업 워커를 각각 별도 터미널에서 실행합니다. 두 명령 모두 공유 또는 릴리스 Supabase 프로젝트를 대상으로 실행하는 것을 거부합니다.

```bash
npm run dev       # web on :3000, agent on :2000
npm run jobs:dev  # iMessage receipts, sends and other jobs
```

4. [http://localhost:3000](http://localhost:3000) (Google 먼저) 또는 [http://localhost:3000/?flow=imessage](http://localhost:3000/?flow=imessage) (iMessage 먼저)를 엽니다.
   - Google 로그인 후 `/app`에 "Send Thyme one message" 단계가 표시됩니다. **Set up here in web chat**을 누르면 이를 건너뛰고 웹 채팅에서 설정합니다.
   - 설정을 확정하면 공개 링크(`/{handle}`)가 생깁니다. 다른 브라우저에서 이 링크로 시간을 요청하고 호스트가 `/app`에서 승인하면 예약됩니다.

## 실제 iMessage와 Google 연결 (영상 재현)

실제 메시지 발신은 설계상 프로덕션 전용입니다. 로컬 실행은 `PHOTON_API_URL`의 로컬 대역 서버로만 전송합니다. 실제 iPhone으로 영상을 재현하려면 발표자의 기기에만 다음을 준비합니다. 이 설정은 커밋하지 않습니다.

- **수신.**
  - Cloudflare quick tunnel 등의 HTTPS 터널로 에이전트의 `/photon/webhook` (:2000)을 노출합니다.
  - 이 주소를 Photon 프로젝트의 webhook으로 등록하고 `PHOTON_WEBHOOK_ID`와 `PHOTON_WEBHOOK_SECRET`을 설정합니다.
- **발신.** 발표자 본인의 번호에 대해서만 Photon으로 전달하는 로컬 대역 서버를 `PHOTON_API_URL`로 지정합니다. 이 서버는 `PHOTON_PROJECT_ID`와 `PHOTON_PROJECT_SECRET`을 사용합니다. 발표자의 전달 어댑터는 저장소에 포함되어 있지 않으므로 새로 clone하는 것만으로 실제 iMessage 발신을 재현할 수는 없습니다. 위 웹 채팅 경로와 자동화 테스트에는 이 어댑터가 필요하지 않습니다.
- **Google 로그인.** 위 OAuth redirect URI를 등록해야 합니다. 휴대전화는 로컬 callback에 접근할 수 없으므로 웹 단계는 Mac 브라우저에서 진행하고 iPhone은 Messages에만 사용합니다.

영상은 다음 순서로 진행됩니다.

1. Mac에서 `/?flow=imessage`를 열고 Messages로 팝업의 미리 작성된 메시지를 보냅니다(또는 iPhone으로 QR 코드를 스캔합니다).
2. 페이지에 수신 완료가 표시되면 Google로 로그인하고 **Confirm and link**를 누른 뒤 사용할 캘린더를 선택합니다.
3. iPhone에서 Thyme의 인사에 답하며 설정을 이어갑니다.

## 검증

```bash
npm run lint
npm run typecheck
npm test                       # unit tests
npm run build
npm run test:integration       # needs the local Supabase stack
npx playwright install chromium
npm run test:e2e               # needs the local Supabase stack
supabase test db               # pgTAP, on a freshly reset database
npm run check:docs
```

통합·브라우저 테스트는 OpenAI, Google, Photon, AgentMail의 로컬 대역 서버를 사용하므로 키 없이 실행됩니다. Wiki의 [Testing Documentation](https://github.com/snuhcs-course/swpp-2026-project-team-01/wiki/Testing-Documentation)에 테스트 방법과 결과를 기록했습니다.

## 예상 오류와 해결 방법

- **`redirect_uri_mismatch`:** Google OAuth 클라이언트에 `http://127.0.0.1:54321/auth/v1/callback`이 등록되어 있는지 확인합니다. 환경 변수를 바꾼 뒤에는 `supabase stop`, `supabase start`로 Auth를 재시작합니다.
- **로그인 후 `/app`이 비어 있거나 `setup_session_unavailable` 발생:** 에이전트(`:2000`)가 실행 중인지 확인합니다. `npm run dev`가 함께 실행합니다.
- **iMessage 화면이 수신 완료로 바뀌지 않음.** 다음을 확인합니다.
  - `npm run jobs:dev`가 실행 중인지;
  - 터널 주소가 Photon webhook과 일치하는지;
  - `PHOTON_WEBHOOK_SECRET`이 정확한지.
- **`supabase test db`에서 `agent_clients_pkey` 중복 오류:** 통합 테스트가 남긴 행이 원인입니다. `supabase db reset --local`을 실행하고 다시 시도합니다.
- **`npm run jobs:dev` 또는 `npm run dev`가 실행을 거부함:** `.env`가 공유 또는 릴리스 프로젝트를 가리킵니다. 로컬 스택 값을 사용합니다.
- **E2E 테스트의 브라우저 오류:** `npx playwright install chromium`을 한 번 실행합니다.

참고: [provider 설정](documentations/technical_specification/03_provider_setup.md), [문서 목차](documentations/README.md), [Supabase 로컬 개발](https://supabase.com/docs/guides/local-development), [Photon webhook](https://photon.codes/docs/webhooks/overview).
