# Repo Structure — AI 미팅 예약 (가칭)

작성일: 2026-09-29 · 상태: 초안 (검토 필요) · 수정: 2026-09-30 (팀 리포 이관)
`src/` 내부 모듈의 세부는 `backend_architecture.md` §1(core/llm/server)과 `frontend_architecture.md` §2(app 라우트)가 기준이다. 이 문서는 최상위 배치만 정한다.

---

팀 리포(`snuhcs-course/swpp-2026-project-team-01`) 안의 배치다. 리포 루트의 `apps/`, `documentaions/`, `supabase/` 구조와 루트 `AGENTS.md`의 규칙을 따른다.

```
swpp-2026-project-team-01/
├─ AGENTS.md                 # 팀 규칙 (Supabase 스키마 변경 절차 포함)
├─ apps/
│  └─ web/                   # 이 MVP 앱
│     ├─ README.md           # 실행 방법 · 문서 색인
│     ├─ AGENTS.md · CLAUDE.md  # Next.js 버전 안내 (next dev가 생성)
│     ├─ src/
│     │  ├─ core/            # 순수 TS: 슬롯·이동시간·필터·순위·예약 규칙  ← 실제 앱으로 이관
│     │  ├─ llm/             # Ollama 어댑터·프롬프트·호출 ①②            ← 실제 앱으로 이관
│     │  ├─ server/          # DB(Drizzle)·repos·services·context       (데모 전용)
│     │  ├─ components/      # 클라이언트/서버 UI 컴포넌트               (데모 전용)
│     │  └─ app/             # Next.js 라우트 + app/api Route Handlers   (데모 전용)
│     ├─ tests/
│     │  ├─ core/            # 이동시간 표 전 칸, 슬롯, 필터·순위, 예약 규칙
│     │  ├─ llm/             # 어댑터(fetch 목), 스키마 검증·재시도
│     │  └─ server/          # 예약·대화 서비스 (PGlite + supabase/migrations)
│     ├─ scripts/
│     │  ├─ db-reset.ts      # 행 삭제 + 시드
│     │  └─ eval-interpret.ts  # 호출 ① 실측: 한국어 입력 → 정확도·지연
│     ├─ .env                # 키 · DATABASE_URL (gitignore)
│     ├─ .env.example        # 키 이름만
│     ├─ package.json · tsconfig.json · next.config.ts · vitest.config.ts
│     └─ .gitignore          # .env, node_modules, .next
├─ documentaions/
│  └─ mvp/                   # 기획·설계 문서 (이 문서 포함)
│     ├─ one_pager.md
│     ├─ product_requirement_document.md
│     ├─ user_stories.md
│     ├─ user_flow.md
│     ├─ app_screen_list.md
│     ├─ technical_architecture.md
│     ├─ frontend_architecture.md
│     ├─ backend_architecture.md
│     ├─ implementation_plan.md
│     └─ repo_structure.md
└─ supabase/
   ├─ config.toml            # schema_paths = ["./schemas/*.sql"]
   ├─ schemas/scheduler.sql  # 선언형 스키마 (원본)
   └─ migrations/            # supabase db diff로 생성한 마이그레이션
```

## 규칙
- `src/core`는 `src/` 안의 다른 폴더를 import하지 않는다. `src/llm`은 `src/core`의 타입만 import한다. 의존 방향은 `technical_architecture.md` §3을 따른다.
- 테스트는 `apps/web/tests/`에 모아서, 이관 대상(core, llm)과 테스트를 함께 들고 갈 수 있게 한다.
- 문서 간 참조는 파일명만 쓴다(같은 `documentaions/mvp/` 폴더 안).
- DB 스키마는 `supabase/schemas/`를 고치고 마이그레이션을 생성한다. 앱 코드에서 테이블을 만들지 않는다.
