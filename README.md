# Find Me a Time — Iteration 1

Google Calendar와 시간 프로필을 바탕으로 만날 수 있는 시간을 찾고, 자연어로 후보를 좁혀 미팅을 요청하는 웹 prototype입니다.

## 목차

- [Demo 영상](#demo-영상)
- [데모 범위](#데모-범위)
- [기술 스택](#기술-스택)
- [배포된 prototype](#배포된-prototype)
- [준비](#준비)
- [Supabase 배포](#supabase-배포)
- [영상 재현: real 모드 설정 및 실행](#영상-재현-real-모드-설정-및-실행)
- [대안: 로컬 Supabase / 예시 데이터](#대안-로컬-supabase--예시-데이터)
- [확인 및 문제 해결](#확인-및-문제-해결)

## Demo 영상

[Iteration 1 demo 영상 보기 / 다운로드](demos/iteration-1-demo.mov) (MOV, 약 26MB, 5분 3초)

이 브랜치는 `mvp/enu3379`의 `2ce5a6f8a371d396aa14ddffb72129fe18ae3fa5`을 기준으로 합니다. 영상의 Google Calendar 연결은 아래 **real 모드**로 재현했습니다.

## 데모 범위

데모 영상에는 Google 계정과 Calendar 연결, 캘린더 선택, 지난 일정의 AI 분석을 통한 시간 프로필 설정, 직접 설정 수정 및 확인, 호스트 예약 링크 확인 흐름을 포함했습니다.

추가로 이 브랜치에는 자연어 기반 예약 후보 탐색, 미팅 요청·수락·거절과 연락처 초대 링크가 구현되어 있습니다. 아래 실행 절차로 자신의 계정을 연결하거나, demo 모드의 시드 계정으로 예약 흐름을 확인할 수 있습니다.

## 기술 스택

| 영역 | 기술 |
|---|---|
| 웹 UI / 서버 API | Next.js 16 App Router, React 19, TypeScript |
| 스타일 | Tailwind CSS |
| 데이터베이스 | Supabase Postgres, Drizzle ORM, postgres-js |
| 로그인 / Calendar | Google OAuth 2.0, Google Calendar API |
| AI | Ollama Cloud (`gemma4:31b`) |
| 테스트 | Vitest, PGlite |
| 웹 호스팅 | Vercel |

## 배포된 prototype

영상에서 사용한 웹 주소: [https://findmeatime-mvp.vercel.app](https://findmeatime-mvp.vercel.app).

Google OAuth가 테스트 상태인 경우 등록된 테스트 계정으로 접속해야 합니다. 직접 재현하려면 아래 Supabase 및 Google 설정으로 자신의 환경을 구성합니다.

## 준비사항

- Node.js 24와 npm
- Supabase CLI **2.119.0** (`supabase --version`으로 확인)
- Ollama Cloud API 키: AI 대화와 캘린더 분석에 사용
- 실제 캘린더를 연결하려면 Google Cloud 프로젝트와 Google 계정
- 로컬 Supabase를 사용하려면 Docker (원격 Supabase 사용 시 불필요)

```bash
git clone --branch iteration-1-demo https://github.com/snuhcs-course/swpp-2026-project-team-01.git
cd swpp-2026-project-team-01
cd apps/web
npm ci
cp .env.example .env
cd ../..
```

## Supabase 배포

1. [Supabase Dashboard](https://supabase.com/dashboard)에서 이 prototype 전용 새 Postgres 프로젝트를 만듭니다. 프로젝트의 reference ID와 데이터베이스 비밀번호를 확인합니다.
2. 저장소 루트에서 로그인하고 대상 프로젝트에 연결한 뒤, 커밋된 migration을 배포합니다. `--dry-run`의 대기 migration 목록과 `supabase/migrations/`의 해당 SQL을 확인한 뒤 `db push`를 실행합니다.

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push --dry-run
supabase db push
supabase migration list
```

3. Dashboard의 **Connect → Transaction pooler** 연결 문자열을 복사해 `apps/web/.env`의 `DATABASE_URL`에 넣습니다. 실제 데이터베이스 비밀번호로 바꾸고, 비밀번호의 특수문자는 URL 인코딩합니다. 원격 연결에는 `sslmode=require`를 지정합니다.

```dotenv
DATABASE_URL=postgresql://postgres.<PROJECT_REF>:<URL_ENCODED_DB_PASSWORD>@<POOLER_HOST>:6543/postgres?sslmode=require
```

앱 서버가 Drizzle/postgres-js로 Postgres에 직접 연결합니다. Supabase Auth 설정이나 `anon`/`service_role` API 키는 필요하지 않습니다. Google 로그인은 앱에서 직접 처리합니다. Supabase 배포는 데이터베이스 배포이며, 웹 앱은 아래 명령으로 별도 실행합니다.

## 프로덕트 실행 방법

1. Google Cloud Console에서 **Google Calendar API**를 활성화합니다.
2. Google Auth platform의 동의 화면을 설정하고, External / Testing을 사용한다면 실행할 Google 계정을 테스트 사용자로 추가합니다.
3. OAuth 클라이언트를 **Web application**으로 생성하고, Authorized redirect URIs에 `http://localhost:3000/api/auth/google/callback`을 등록합니다.
4. Data Access에 로그인 scope(`openid`, `email`, `profile`)와 다음 Calendar scope를 등록합니다.

```text
https://www.googleapis.com/auth/calendar.calendarlist.readonly
https://www.googleapis.com/auth/calendar.events.readonly
https://www.googleapis.com/auth/calendar.events.freebusy
```

`apps/web/.env`에 아래 값을 설정합니다. `TOKEN_ENCRYPTION_KEY`와 `IMPACT_SIGNING_KEY`는 각각 `openssl rand -hex 32`를 실행해 얻은 서로 다른 값을 사용합니다. 토큰 암호화 키는 재시작 후에도 유지합니다.

```dotenv
APP_MODE=real
DATABASE_URL=<위에서 설정한 Supabase 연결 문자열>
OLLAMA_API_URL=https://ollama.com/api/chat
OLLAMA_API_KEY_1=<OLLAMA_CLOUD_API_KEY>
OLLAMA_MODEL=gemma4:31b
GOOGLE_CLIENT_ID=<GOOGLE_OAUTH_CLIENT_ID>
GOOGLE_CLIENT_SECRET=<GOOGLE_OAUTH_CLIENT_SECRET>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
TOKEN_ENCRYPTION_KEY=<첫 번째 64자리 hex 값>
IMPACT_SIGNING_KEY=<두 번째 64자리 hex 값>
```

Ollama 키는 한 개면 실행할 수 있습니다. `OLLAMA_API_KEY_2`, `OLLAMA_API_KEY_3`를 입력해 두면 인증 오류나 요청 제한 시 다음 키를 사용합니다. `.env`와 모든 키는 Git에 올리지 않습니다.

```bash
cd apps/web
npm run dev
```

[http://localhost:3000](http://localhost:3000)을 엽니다. OAuth callback과 같은 호스트를 사용해야 합니다.

1. Google 로그인 후 **Calendar 연결**에서 계정을 연결하고 가져올 캘린더를 선택합니다.
2. **AI로 설정 시작하기**로 일정 분석과 시간 프로필 설정을 진행하고, 근무시간·미팅 가능 시간·선호를 확인한 뒤 확정합니다.
3. **호스트 설정**에서 장소와 미팅 양식을 설정하고 **내 예약 링크**를 복사합니다.
4. 예약 흐름까지 확인하려면 다른 Google 계정으로 로그인해 링크를 열고, **예약하기**에서 후보를 좁혀 요청을 보냅니다. 호스트는 **받은 요청함**에서 수락/거절합니다.

real 모드는 빈 데이터베이스에서 시작하며 로그인 시 사용자가 생성됩니다. 

## 로컬 실행 방법

원격 대신 로컬 DB를 사용하려면 Docker를 실행하고 저장소 루트에서 다음을 실행하면 됩니다. `db reset --local`은 기존 로컬 데이터를 삭제하므로 재현용 DB에서 사용해야 합니다. SQL seed 대신 앱의 시드 스크립트를 사용합니다.

```bash
supabase start
supabase db reset --local --no-seed
supabase status
```

`apps/web/.env`의 `DATABASE_URL`을 `supabase status`에 표시된 DB URL로 바꿉니다(기본 `postgresql://postgres:postgres@127.0.0.1:54322/postgres`). 로컬에서도 위 Google 설정과 `APP_MODE=real`을 사용하면 실제 Calendar 연결을 실행할 수 있습니다.

Google 설정 없이 예시 데이터로 예약 기능을 확인하려면 **별도의 demo 전용 DB**에 migration을 적용하고, `.env`의 `APP_MODE=demo`와 해당 `DATABASE_URL`, Ollama 키를 설정합니다.

```bash
cd apps/web
npm run db:reset
npm run dev
```

`npm run db:reset`은 지정한 DB의 앱 데이터를 모두 삭제하고 실행일 기준 시드 데이터를 만듭니다. 상단 사용자 전환으로 김민준·이서연·박지호·최하나를 선택할 수 있습니다. Calendar 연결은 예시 캘린더로 동작합니다. **real과 demo는 같은 DB를 공유할 수 없습니다.** 상세 예시 시나리오는 [웹 앱 README](apps/web/README.md)를 참고해 주세요.

## 예상되는 오류와 해결 방법

`build`도 DB에 접근하므로, 위 환경 변수 설정과 migration 적용을 먼저 완료하고 DB가 실행 중인 상태에서 실행합니다.

```bash
cd apps/web
npm test
npm run typecheck
npm run build
npm start
```

- DB 연결 오류: 프로젝트가 실행 중인지, pooler 호스트·비밀번호·포트가 정확한지 확인합니다.
- 테이블이 없다는 오류: `supabase migration list`로 로컬/원격 migration 목록이 일치하는지 확인합니다.
- `redirect_uri_mismatch`: Google Console의 redirect URI와 `.env`, 브라우저 접속 주소를 맞춥니다. 환경 변수를 변경하면 서버를 재시작합니다.
- AI 호출 오류: Ollama 키, 모델 접근 권한 및 요청 제한을 확인합니다.
- DB mode 오류: 해당 모드 전용 DB를 사용합니다. 실제 계정 DB를 시드로 초기화하지 않습니다.

배포 절차 참고: [Supabase 환경 및 migration 관리](https://supabase.com/docs/guides/deployment/managing-environments), [Postgres 연결](https://supabase.com/docs/guides/database/connecting-to-postgres), [Google Calendar API 및 OAuth 설정](https://developers.google.com/workspace/calendar/api/quickstart/js).
