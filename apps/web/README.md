# AI 미팅 예약 (가칭) — MVP 데모

두 사람의 캘린더와 이동시간으로 "실제로 만날 수 있는 시간"을 계산해두고, 클라이언트가 자연어 대화로 원하는 시간을 좁혀 호스트에게 예약을 요청하는 웹 앱이다.

> 상태: 기획·설계와 구현(M0–M7) 완료. 데모 시나리오는 아래 참조.

## 문서
진행 순서대로 정리했다.

1. [One Pager](../../documentaions/mvp/one_pager.md): 목표, 범위, 핵심 규칙
2. [PRD](../../documentaions/mvp/product_requirement_document.md): 기능·비기능 요구사항, 수용 기준
3. [User Stories](../../documentaions/mvp/user_stories.md) → [User Flow](../../documentaions/mvp/user_flow.md) / [App Screen List](../../documentaions/mvp/app_screen_list.md)
4. [Technical Architecture](../../documentaions/mvp/technical_architecture.md) → [Frontend](../../documentaions/mvp/frontend_architecture.md) / [Backend](../../documentaions/mvp/backend_architecture.md)
5. [Implementation Plan](../../documentaions/mvp/implementation_plan.md) · [Repo Structure](../../documentaions/mvp/repo_structure.md)

## 스택
Next.js(App Router) · TypeScript · Supabase(Postgres) + Drizzle · Tailwind · Vitest · Ollama Cloud(`gemma4:31b`)

## 실행
```bash
# 리포 루트에서: 로컬 Supabase(Docker 필요)를 띄우고 supabase/migrations 적용
supabase start
supabase db reset

# apps/web 에서
npm install
cp .env.example .env      # 키 입력 (OLLAMA_API_KEY_1..3). DATABASE_URL 기본값이 로컬 Supabase
npm run db:reset          # 모든 행 삭제 후 시드(실행일 기준 60일)
npm run dev               # http://localhost:3000
npm test                  # 단위·서버 테스트 (서버 테스트는 PGlite에 같은 migrations를 적용해 실행, Docker 불필요)
```

스키마는 리포 루트 `supabase/schemas/scheduler.sql`에 있고, 바꿀 때는 루트 `AGENTS.md`의 "Supabase schema changes" 절차를 따른다. `src/server/db/schema.ts`(Drizzle)도 같이 맞춘다.

`npm run dev:mock`은 데모 모드 인스턴스를 3100 포트에서 따로 띄운다(`.next-mock`에 빌드되어 실제 모드 인스턴스와 나란히 실행 가능). 데모 모드에서 Calendar 연결은 Google 대신 계정별 예시 일정을 가져온다.

개발 서버와 `npm start`는 `127.0.0.1`에만 열린다. 서버 로그는 JSON 한 줄씩 나오고 `LOG_LEVEL=silent`로 끌 수 있다.

## 환경 변수
| 이름 | 설명 |
|---|---|
| `OLLAMA_API_URL` | `https://ollama.com/api/chat` |
| `OLLAMA_API_KEY_1..3` | Ollama Cloud 키. 401/403/429 응답 시 다음 키로 로테이션 |
| `OLLAMA_MODEL` | 기본 `gemma4:31b` |
| `DATABASE_URL` | Postgres 연결 문자열. 로컬은 `supabase status`의 DB URL, 원격은 Supabase transaction pooler(6543) URL |
| `APP_MODE` | `demo`(기본, 시드 계정·사용자 전환·예시 Calendar) 또는 `real`(Google 로그인·Calendar 읽기). DB는 한 번 모드에 묶이며 섞어 쓸 수 없다 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | real 모드 전용. 리디렉션 URI는 Google Cloud console에 등록한 값과 같아야 한다 |
| `TOKEN_ENCRYPTION_KEY` / `IMPACT_SIGNING_KEY` | real 모드 전용 32바이트 키(`openssl rand -hex 32`) |
| `DATABASE_POOL_MAX` | 선택. 연결 풀 크기(기본 5) |

## 예약 링크
연락처로 추가한 사람만 예약할 수 있다(데모 포함). 호스트 설정의 "내 예약 링크"(`/invite/<토큰>`)를 보내면, 받은 사람이 링크를 열거나 예약하기 화면에 붙여 넣을 때 서로 연락처가 된다. "새 링크로 바꾸기"를 하면 이전 링크는 열리지 않고 기존 연락처는 유지된다. 데모 시드는 김민준↔박지호, 김민준↔최하나만 연결해 두고 이서연은 비워 둔다. 이서연으로 바꿔 호스트 설정의 링크를 복사한 뒤, 박지호로 바꿔 링크를 열거나 예약하기에 붙여 넣으면 링크 흐름을 확인할 수 있다.

## 데모 시나리오
데모 전에 `npm run db:reset`으로 오늘 날짜 기준 데이터를 새로 만든다. 상단 "현재 사용자"로 역할을 바꾼다.

시드: 호스트 **김민준**, **이서연** / 클라이언트 **박지호**, **최하나** (최하나는 장소·양식이 없어 "예약 불가"). 박지호·최하나는 처음에 김민준만 예약할 수 있다.

1. **박지호**로 "예약하기" → 김민준 선택.
2. 입력: `다음 주 평일 오후에 온라인이면 좋겠어. 금요일은 절대 안 돼`
   - 칩 4개가 생기고(날짜·요일·시간대·장소), 남은 후보가 수백 개라 AI가 분포를 근거로 되묻는다. 버튼은 나오지 않는다.
3. 입력: `제일 빠른 걸로 보여줘` → "빠른 순" 칩이 붙고 후보 버튼 3개가 나온다.
4. 칩의 ×를 눌러 "월–목" 조건을 지우면 LLM 호출 없이 후보 수가 다시 계산된다.
5. 버튼 하나를 눌러 메시지를 쓰고 "요청 보내기".
6. **최하나**로 바꿔 김민준에게 **같은 시간**을 요청한다(대기 요청은 슬롯을 막지 않는다).
7. **김민준**으로 바꿔 "받은 요청함": 같은 시간대의 두 요청이 한 묶음으로 보인다. 하나를 수락하면 "겹치는 요청 1건은 자동 거절됩니다" 확인 후 나머지는 자동 거절된다.
8. 김민준과 박지호의 "내 캘린더"에 미팅이 추가된다. 같은 시간은 더 이상 요청할 수 없다.

검증한 범위와 한계는 [`documentaions/mvp/implementation_plan.md`](../../documentaions/mvp/implementation_plan.md) M7 절에 적었다.
