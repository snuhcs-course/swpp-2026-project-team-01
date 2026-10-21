# Find Me a Time

> 한국어 번역본 (검토용). 원본: README.md

외부 일대일 미팅을 위한 AI 일정 조율 에이전트입니다. **Thyme**은 시간을 협상하며, 예약은 호스트가 현재 제안을 명시적으로 승인해야 확정됩니다.

도메인: [findmeatime.com](https://findmeatime.com) · SNU SWPP 프로젝트 팀 01

## 상태

**기반 구축 진행 중입니다.** 제품 방향, 사용자 경험, 아키텍처, 제공자 설정, 시각 디자인, 기능 명세는 이 저장소에서 합의되었습니다. 구현은 런타임 스택을 기록한 [`application-foundation`](openspec/changes/application-foundation/proposal.md) 변경으로 시작되었으며, 애플리케이션 골격은 빌드되고 검사를 통과합니다.

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
| `supabase/` | 로컬 Supabase 설정. 애플리케이션 SQL은 첫 스키마 변경과 함께 들어옴 |
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
