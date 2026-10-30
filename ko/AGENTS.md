# 에이전트 지침

> 한국어 번역본 (검토용). 원본: AGENTS.md

이 저장소는 SNU SWPP 프로젝트 팀 01의 작업 공간입니다. 변경을 작고 검토하기 쉽게 유지하고, 팀이 합의한 요구사항에 맞춥니다.

## 프로젝트 상태

구현은 [`application-foundation`](openspec/changes/application-foundation/proposal.md) 변경으로 시작되었으며, 그 [설계](openspec/changes/application-foundation/design.md)가 런타임 스택을 기록합니다. Phase 1(로그인, `/app` 작업 공간, Supabase 스키마 기준선, 플랫폼 메커니즘)과 Phase 2([`host-onboarding`](openspec/changes/host-onboarding/proposal.md): 호스트 설정, 공개 호스트 페이지와 스킬 문서, 핸들과 가입 한도, 관리자 CLI)는 구현과 배포를 마쳤고 [인수 기록](documentations/technical_specification/07_acceptance_record.md)에 기록되어 있습니다. Phase 3부터 8까지(요청자 접수, 호스트 검토와 예약, 에이전트 접근, 호스트 iMessage 채널, 요청자 이메일 채널, 운영과 릴리스)는 병합되었고 2026-10-30부터 프로덕션에 배포되어 있습니다. 이들의 프로덕션, 명명된 클라이언트, 기기, 받은편지함 증거는 아직 보류 중이며, iMessage는 Photon 회선과 웹훅이 준비될 때까지 꺼져 있습니다. 열린 OpenSpec 변경 안에서만 구현하십시오.

공유 Supabase 프로젝트는 `anelszynxtvxoxqvzgqt`이며, `20261023134957_imessage_start.sql`까지의 마이그레이션 체인 전체를 담고 있습니다. 마지막 푸시는 배포 워크플로의 저장소 시크릿이 설정되지 않아 2026-10-30에 수동으로 했습니다([환경과 협업](documentations/technical_specification/03_provider_setup.md#environments-and-collaboration) 참고). 네임스페이스, 기본 권한, RLS는 스키마 기준선이 선언한 대로 유지하며, [제공자 설정](documentations/technical_specification/03_provider_setup.md#supabase-project)의 설명을 따르십시오. 상태를 확인하지 않은 프로젝트에 마이그레이션 체인을 푸시하지 마십시오.

## 저장소 구조

- `agent/`: eve 에이전트 정의, 지침, 채널입니다. `agent/channels/eve.ts`는 모든 `/eve/v1` 경로를 애플리케이션 코드로 인가합니다.
- `apps/web/`: Next.js 웹 앱입니다. `/`는 공개 진입점이고 `/app`은 대화를 담습니다.
- `lib/contracts/`와 `lib/server/`: 에이전트와 웹 앱이 공유하는 브라우저 안전 계약과 서버 전용 코드입니다.
- `tests/integration/`과 `tests/e2e/`: Vitest 통합 테스트와 Playwright 브라우저 테스트입니다. 단위 테스트는 각 모듈 옆에 있습니다.
- `documentations/`: 제품 방향, 릴리스 범위, 조사, 설명 문서입니다. `01_one_pager.md`부터 시작합니다.
- `openspec/specs/`: 주요 기능 명세입니다. 자세한 동작은 `<capability>/spec.md`에 있습니다.
- `openspec/changes/`: 제안된 동작 변경과 보관된 구현 기록입니다.
- `supabase/`: 로컬 Supabase 설정, 원하는 스키마, 검토를 마친 마이그레이션 체인, 데이터베이스 테스트입니다.

## 도구 사전 요구사항

Node.js 24와 npm을 사용합니다. `npm ci`로 설치한 뒤, CI가 실행하는 검사를 실행하십시오.

```sh
npm run build        # eve build, then next build for apps/web
npm run lint         # oxlint agent apps lib tests
npm run typecheck
npm test             # Vitest unit tests
```

`npm run test:integration`은 로컬 스택(`supabase start`)에 대해 Vitest 통합 테스트를 한 파일씩 실행합니다. 일부 테스트는 로컬 OpenAI 대역(stand-in)과 함께 `eve dev` 또는 `eve build`와 `eve start`를 띄웁니다. `npm run test:e2e`는 3100–3102번 포트의 `next dev`, `eve dev`, 같은 대역을 대상으로 Playwright를 실행하며, 모두 로컬 스택을 가리킵니다(브라우저는 `npx playwright install chromium`으로 한 번 설치). 테스트는 우회 경로가 아니라 실제 로컬 Auth 흐름으로 로그인합니다. `npm run test:e2e`에 `E2E_LIVE_MODEL=1`을 설정하면 `OPENAI_API_KEY`로 실제 `gpt-5.6-terra`를 사용해 로그인부터 첫 답장까지의 여정만 실행합니다. 비용이 들기 때문에 CI는 이 값을 설정하지 않습니다. 로컬 개발에서는 `.env.example`을 바탕으로 `.env`를 채우고, 로컬 스택 값 같은 로컬 재정의는 `.env.local`에 넣은 뒤 `npm run dev`를 실행하십시오. 이 명령은 3000번 포트의 웹 서비스와 2000번 포트의 `eve dev`를 모두 루트 env 파일로 시작하며(eve와 Next.js의 순서대로 프로세스 환경이 우선하고, 그다음 `.env.development.local`, `.env.local`, `.env.development`, `.env` 순), 공유 프로젝트와 릴리스 프로젝트는 거부합니다. `npm run dev:web`은 같은 환경으로 웹 서비스만 실행하고, `npm run dev:eve`는 터미널 UI와 함께 에이전트를 실행합니다. 로컬에서 만들어진 작업을 `DATABASE_URL`에 대해 처리하려면 `npm run jobs:dev`를 실행하십시오. 이 명령은 공유 프로젝트와 릴리스 프로젝트를 거부합니다.

GitHub CLI(`gh`), Vercel CLI(`vercel`), Supabase CLI(`supabase`)가 설치되어 `PATH`에서 사용할 수 있다고 가정합니다.

이 저장소에서는 Supabase CLI **2.119.0**을 사용하고, `supabase --version`으로 확인합니다. CLI 업그레이드는 팀과 조율하고, 업그레이드할 때마다 스키마 워크플로를 다시 확인합니다.

OpenSpec CLI **1.14.0**은 core 프로필과 Codex 통합과 함께 사용합니다. macOS에서는 `brew install openspec`으로, Node.js 20.19.0 이상에서는 `npm install -g @fission-ai/openspec@1.14.0`으로 설치합니다. 그다음 `openspec --version`으로 확인합니다. 새 체크아웃은 `openspec init --tools codex --profile core`로 초기화합니다. 조율된 CLI 업그레이드 후에는 이 저장소에서 `openspec update`를 실행하고, 생성된 스킬 변경 사항을 검토합니다.

## 도메인과 DNS

제품은 **Find Me a Time**이며, 구매한 도메인은 **findmeatime.com**입니다. Cloudflare가 등록 기관이자 권한 DNS 제공자입니다. 도메인이 Cloudflare에 등록되어 있는 동안에는 Cloudflare 네임서버를 유지합니다. 앱 호스팅은 Vercel을 독립적으로 사용할 수 있습니다.

DNS 관리에는 공식 Cloudflare CLI인 `cf`(`cloudflare`로도 사용 가능)를 사용합니다. 검증된 버전은 **1.0.0-beta.12**입니다. Node.js 22.18 이상에서 `npm install --global cf@1.0.0-beta.12`로 설치하고, `cf --version`으로 확인합니다. CLI가 베타 단계이므로 업그레이드 후에는 명령 문법을 다시 검증합니다.

- `cf auth login`으로 인증하고, `cf auth whoami`로 확인합니다. 비대화형 자동화에는 `CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID`를 사용합니다. 토큰은 필요한 계정, 영역, 권한으로 범위를 제한합니다. 토큰, 로컬 인증 파일, `.cloudflare/` CLI 캐시는 Git에서 제외합니다.
- `cf cli search "create a DNS record"`로 명령을 찾습니다. 검색어에는 동작과 리소스 유형만 사용합니다. 선택한 명령의 `--help`나 `cf schema` 출력으로 인수와 요청 필드를 확인합니다.
- `cf zones list --name findmeatime.com`으로 영역을 확인하고, `cf dns records list --zone findmeatime.com`으로 기존 레코드를 확인합니다. 계정 ID와 영역 ID는 추측하지 말고, 인증된 계정에서 가져옵니다.
- `cf dns records create --zone findmeatime.com --body '<JSON>'`으로 레코드를 만듭니다. 드라이 런은 도메인 이름이 아니라 실제 영역 ID를 사용해 `--dry-run`으로 미리 봅니다. 이메일과 인증 레코드를 포함한 관련 없는 레코드는 보존합니다. 변경 후에는 레코드를 다시 읽어 최종 상태를 확인합니다.

Vercel 배포를 위한 절차는 다음과 같습니다.

1. 대상 Vercel 팀과 프로젝트를 확인한 뒤, 해당 범위에서 `vercel domains add findmeatime.com <project-name>`으로 도메인을 연결합니다.
2. `vercel domains inspect findmeatime.com`을 실행해 필요한 정확한 DNS 레코드를 확인합니다. 일반적인 IP 주소나 CNAME 대상을 복사하지 말고, 현재 값을 사용합니다.
3. Vercel 웹 레코드는 `proxied: false`(DNS 전용)로 설정하여 `cf`로 적용합니다. `vercel dns`는 Cloudflare 네임서버에 호스팅된 레코드를 관리하지 않습니다.
4. `vercel domains inspect findmeatime.com`, DNS 조회, 예상 배포에 대한 HTTPS 요청으로 확인합니다. 활성 Cloudflare 영역만으로는 앱이 연결되었다고 볼 수 없습니다.

참고: [Cloudflare CLI 설정](https://developers.cloudflare.com/cf/get-started/), [DNS 관리](https://developers.cloudflare.com/cf/get-started/resources/), [Vercel 사용자 지정 도메인](https://vercel.com/docs/domains/set-up-custom-domain).

## 작업 협약

- 편집하기 전에 관련 파일을 읽습니다. 제품 아키텍처나 의존성을 추측하지 않습니다.
- 참고 저장소를 적극 활용합니다. 모듈을 설계하거나 구현하기 전에 [참고 저장소](documentations/technical_specification/02_frontend_architecture.md#reference-repositories)가 같은 것을 어떻게 구성하고 스타일링하고 테스트하는지 읽고, 우리 계약이 달리 정하지 않는 한 그 아키텍처와 디자인을 따릅니다. 따른 저장소와 리비전을 풀 리퀘스트에 적습니다.
- 비밀 값, 자격 증명, 로컬 환경 파일은 Git에서 제외합니다. 설정을 공유해야 하면 예시를 추가합니다.
- 변경한 파일에 관련된 검사를 실행합니다. 실행할 수 없는 검사는 보고합니다.
- 사용자에게는 한 번에 한 가지만 요청합니다. 대화에는 한 번에 작은 카드 또는 질문 하나만 보이며, 스크롤해야 하는 여러 개를 쌓아 두지 않습니다. [한 번에 하나만 생각하게 한다](documentations/03_design_principles.md#4-one-thing-to-think-about-at-once)와 `DESIGN.md`의 카드 레시피를 따릅니다.
- 기능을 변경할 때마다 제품, UX, 기술, 설정, API 문서를 갱신해야 하는지 확인합니다. 동작이나 설정이 바뀌면 같은 변경에서 해당 문서를 갱신합니다. 갱신이 필요 없다면 최종 보고에 그 이유를 적습니다.

## 문서와 명세

문서들이 같은 요구사항을 반복하지 않고 서로 보완하도록 유지합니다.

- `documentations/`는 제품 목적, 대상 사용자, 릴리스 범위, 조사, 아키텍처 개요 같은 설명을 담당합니다. 원페이저와 PRD는 제품 의도를 설명하고, 상세 동작은 기능 명세에 링크합니다.
- `openspec/specs/<capability>/spec.md`는 각 기능의 현재 합의된 동작 계약을 담당합니다. 요구사항과 관찰 가능한 시나리오를 포함합니다. 완료되고 검증된 변경과 일치하도록 유지합니다.
- `openspec/changes/<change-name>/`는 제안된 변경분, 근거, 필요할 때의 기술 결정, 구현 작업을 담당합니다. 대기 중인 요구사항은 변경이 완료되어 주요 명세에 보관되기 전까지 이곳에 둡니다.

실질적인 기능이나 동작 변경에는 OpenSpec을 사용합니다. 기존 동작을 보존하는 일상적인 문서 편집, 유지보수, 작은 수정에는 새 제안이 필요하지 않습니다. 범위가 정해진 변경으로 시작하고, 요구사항을 검토하고, 구현하고 테스트한 뒤, 보관하여 주요 명세를 갱신합니다. 미해결 PRD 결정이나 초안 요구사항을 확정 명세로 승격하지 마십시오.

각 변경에는 추적 이슈를 하나 두고 양쪽으로 링크합니다. 이슈에는 변경 이름을, `proposal.md`에는 이슈 번호를 적습니다. `tasks.md` 항목마다 이슈를 만들지 않습니다. 변경의 일부를 다른 사람이나 다른 풀 리퀘스트가 맡을 때만 하위 이슈로 나눕니다. 변경의 일부를 구현하는 풀 리퀘스트는 `Part of #N`처럼 닫는 키워드 없이 이슈를 참조하고, 변경을 보관하는 풀 리퀘스트는 구현까지 함께 하더라도 `Closes #N`으로 이슈를 닫습니다. 보관하기 전에 구현하면서 바뀐 내용을 변경분에 반영합니다. 보관된 변경은 기록입니다. 이후 동작을 바꿀 때는 보관본을 고치지 말고 새 변경을 만듭니다.

제품 문서와 기능 명세가 어긋나면, 영향을 받는 동작을 구현하기 전에 그 불일치를 명시적으로 해결합니다. 하나의 해석을 조용히 선택하거나 충돌하는 사본을 유지하지 말고, 소유 문서와 링크를 갱신합니다.

OpenSpec 검증은 산출물 구조와 명세 일관성을 확인하며, 구현이 동작한다는 것을 증명하지 않습니다. 변경을 완료로 보기 전에 관련 자동화 테스트를 실행하고 코드를 검토합니다. `openspec/config.yaml`, 명세, 변경 산출물, 생성된 프로젝트 스킬은 Git에 보관합니다.

참고: [OpenSpec 빠른 시작](https://openspec.dev/docs/quickstart).

## 한국어 번역본

`ko/`는 팀 검토용으로 영어 문서를 그대로 옮긴 번역본이며, 영어 문서가 기준입니다. 사용자가 번역을 요청하거나 한국어 파일을 지목하지 않는 한 `ko/`를 읽거나 검색하거나 인용하지 마십시오. 루트의 `.ignore`가 ripgrep 기반 검색에서 `ko/`를 제외하고, 프로젝트 설정은 `ko/` 아래 파일을 읽기 전에 확인을 요청합니다. 영어 문서가 바뀌면 한국어 파일을 직접 고치지 말고 영어 원본에서 번역본을 다시 만들고, 원본 경로를 적은 첫 줄 배너를 유지하며, 헤딩·표·링크·Mermaid 블록의 구조를 동일하게 유지하십시오.

## Git 브랜치 규칙

- `main`은 통합 브랜치입니다. 변경에는 토픽 브랜치와 풀 리퀘스트를 사용합니다. `main`에 직접 커밋하지 않습니다.
- 새 브랜치 이름은 `<type>/<short-description>` 형식을 따르며, 아래 커밋 타입을 사용합니다. 각 부분은 소문자, 숫자, 하이픈으로 구성합니다. 예: `fix/booking-timezone`, `docs/branch-conventions`. `codex/` 접두사를 쓰지 않습니다. 사용자가 명시적으로 브랜치 이름을 주면 그 이름을 따릅니다.
- 각 브랜치는 하나의 기능, 수정, 또는 문서 작업에 집중합니다. OpenSpec 변경을 구현할 때는 가능하면 변경 이름을 설명으로 재사용합니다. 예: `feat/connect-google-calendars`.
- 새로운 독립 작업은 fetch 후 최신 `origin/main`에서 시작합니다. 기존 작업은 기존 브랜치에서 이어 갑니다. 작업이 명시적으로 다른 기반에 의존할 때만 다른 기반을 사용합니다.
- 브랜치를 전환하거나 만들기 전에 현재 브랜치와 작업 트리를 확인합니다. 관련 없는 로컬 변경은 보존합니다. 격리가 필요하면 별도 워크트리를 사용합니다. 규칙에 맞추려고 기존 브랜치 이름을 바꾸지 않습니다.
- 공유 브랜치의 이력은 그대로 보존합니다. 명시적 승인 없이 공유 브랜치를 강제 푸시하거나 리베이스하지 않습니다.
- 풀 리퀘스트가 병합되고 작업이 더 필요 없으면 토픽 브랜치를 삭제합니다. 병합되지 않은 작업이 있거나 활성 워크트리가 있는 브랜치는 삭제하지 않습니다.

## Git 워크플로와 풀 리퀘스트

네 명으로 구성된 팀은 이슈에서 시작하는 GitHub Flow를 사용합니다. 이슈를 열고, `main`에서 짧게 사는 작업 브랜치를 만들고, 풀 리퀘스트를 열고, 검토와 검사를 거쳐 병합하고, 브랜치를 삭제합니다. 애플리케이션 코드가 추가되는 동안에도 `main`은 배포 준비 상태를 유지합니다. 완성되지 않은 작업은 작업 브랜치에서 진행합니다.

- 작업을 시작하거나 이슈를 열기 전에, 그 작업이 이미 추적되고 있거나 진행 중인지 확인합니다. 열린 이슈와 닫힌 이슈(`gh issue list --state all --search "<words>"`), 그리고 열린 풀 리퀘스트(`gh pr list --search "<words>"`)를 검색합니다. 일치하는 열린 이슈가 있으면 중복 이슈를 열지 말고 그것을 재사용합니다. 닫힌 이슈나 병합된 풀 리퀘스트가 이미 그 작업을 다룬 경우에는, 이슈를 다시 열거나 새 이슈를 열기 전에 문제가 여전히 남아 있는지 확인합니다.
- 모든 작업은 이슈에서 시작하여, 팀이 누가 무엇을 하는지 볼 수 있고 두 사람이 같은 일을 하지 않도록 합니다. 작업을 시작할 때 자신을 담당자로 지정합니다(`gh issue edit <N> --add-assignee @me`). 다른 사람이 그 이슈를 맡고 있거나 그 이슈에 대한 풀 리퀘스트를 열어 두었다면, 넘겨받기 전에 그 사람에게 먼저 물어봅니다.
- 모든 풀 리퀘스트는 `Closes #N` 또는 `Part of #N`으로 해당 이슈에 연결합니다. 핫픽스, 즉 깨진 `main`이나 배포를 위한 긴급 수정만 이슈 없이 진행할 수 있으며, 그 풀 리퀘스트 설명에 핫픽스임을 밝힙니다.
- 각 작업 브랜치는 최신 `main`에서 만들고, 위 브랜치 규칙에 따라 이름을 붙이며, 목적은 하나로 한정합니다.
- 풀 리퀘스트는 작게 유지하고, 관련 없는 변경은 분리합니다. 결과로 생기는 동작, 근거, 검증 내용을 설명하고, 실행하지 못한 검사도 포함합니다. `main`의 변경을 정기적으로 반영하고, 병합 전에 충돌을 해결합니다.
- 풀 리퀘스트 설명은 [`.github/pull_request_template.md`](../.github/pull_request_template.md)의 섹션에 맞춰 작성합니다. GitHub 웹에서는 템플릿이 자동으로 채워지지만 `gh pr create --body`는 그렇지 않으므로, 에이전트는 템플릿의 섹션을 직접 옮겨 씁니다.
- 버그, 문서·명세 불일치, 기능 아이디어, 계획된 작업은 `.github/ISSUE_TEMPLATE/`의 양식으로 이슈를 엽니다. 빈 이슈는 비활성화되어 있습니다. 이슈는 아이디어와 작업을 추적합니다. 규모가 큰 동작 변경의 요구사항은 해당 OpenSpec 변경에 두고, 추적 이슈는 요구사항을 다시 적지 않고 그 변경이나 변경을 추가하는 풀 리퀘스트에 링크합니다.
- `main`으로 가는 모든 변경은 풀 리퀘스트를 거칩니다. 병합 전에 작성자가 아닌 팀원 최소 한 명의 승인과 관련 CI 검사 통과를 요구합니다.
- `main`의 브랜치 보호는 승인 한 명(새로 푸시하면 이전 승인은 무효가 됩니다), 해결된 리뷰 대화, 그리고 `main`의 최신 상태를 반영한 브랜치에서 통과한 `application`, `database`, `documentation` 검사를 요구합니다. 관리자는 이를 우회할 수 있습니다.
- 기본적으로 **Squash and merge**를 사용하여 각 풀 리퀘스트가 `main`의 하나의 논리 커밋이 되도록 합니다. 풀 리퀘스트 제목과 최종 스쿼시 메시지에는 아래 커밋 메시지 형식을 사용하고, 유용한 Lore 결정 맥락은 최종 메시지에 보존합니다.
- 풀 리퀘스트의 개별 커밋이 이미 의미가 있고, 독립적으로 검토할 수 있으며, 보존할 가치가 있을 때만 예외로 **Rebase and merge**를 사용합니다. 일반 풀 리퀘스트에는 병합 커밋이 필요하지 않습니다.
- 풀 리퀘스트가 병합되면 GitHub가 원격 브랜치를 삭제합니다. 로컬 브랜치를 삭제하고, 다음 작업은 최신 `main`에서 시작합니다. 특히 스쿼시 병합 후에는 그렇게 합니다. 공유 브랜치의 이력을 다시 쓰기 전에는 팀원과 조율합니다.

영구적인 `develop` 브랜치 없이 이 워크플로를 사용합니다. 프로젝트가 동시에 지원해야 하는 버전이나 별도의 릴리스 안정화 기간이 필요해지면 Git Flow나 릴리스 브랜치를 다시 검토합니다.

참고: [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow), [PR 병합 방식](https://docs.github.com/en/pull-requests/reference/pull-request-merges).

## 커밋 메시지

Conventional Commit 타입과 Lore Commit Protocol을 사용합니다. 모든 커밋 메시지는 `type(scope): intent`로 시작합니다. 범위(scope)는 선택 사항입니다. 의도는 간결하게 쓰고, 명령형 동사를 사용하며, 변경이 왜 필요한지 설명합니다.

타입:

- `feat`: 새로운 기능.
- `fix`: 버그 수정.
- `docs`: 문서.
- `refactor`: 동작 변경 없는 코드 재구성.
- `test`: 테스트.
- `build`: 의존성 또는 빌드 도구.
- `ci`: CI 설정.
- `chore`: 기타 유지보수.
- `perf`: 성능 개선.
- `revert`: 커밋 되돌리기.

범위에는 `supabase`, `product`, `git`처럼 영향을 받는 영역을 짧게 씁니다. 예: `docs(supabase): align schema guidance with pg-delta`.

결정 맥락이 유용할 때만 선택적인 본문과 git 네이티브 Lore 트레일러를 추가합니다.

```text
Constraint: <external constraint that shaped the decision>
Rejected: <alternative considered> | <reason for rejection>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <forward-looking warning for future modifiers>
Tested: <what was verified>
Not-tested: <known gaps in verification>
```

앞으로 수정할 사람이 다시 검토하지 말아야 할 대안은 `Rejected:`로 기록합니다. 경고는 `Directive:`로 씁니다. 유용한 맥락을 더하는 트레일러만 포함합니다.

## AI 사용 기록

각 작업은 하나의 브랜치이며, 각 작업은 그 작업에 사용한 Claude Code와 Codex 토큰 및 에이전트 작업 시간을 보고합니다.

- 클론마다 한 번 설정합니다. `git config core.hooksPath .githooks`를 실행합니다. 그러면 pre-commit 훅이 모든 커밋에서 `node scripts/ai-usage.mjs record --stage`를 실행합니다. 이 명령은 로컬 Claude Code와 Codex 로그(CLI와 데스크톱 앱)를 읽고 `ai-usage/<branch>/<git user.email>.json`을 갱신합니다. 토큰 수와 에이전트 시간만 저장하며, 프롬프트는 저장하지 않습니다.
- 사용량은 작업 디렉터리와, 그 워크트리에 체크아웃되어 있던 브랜치를 기준으로 귀속됩니다. 따라서 저장소나 그 워크트리 안에서 에이전트를 실행합니다. 모든 새 작업의 세션은 새로 만든 자기 브랜치에서 시작합니다. 다른 작업의 브랜치나 워크트리에서 연 세션은 그 작업에 집계됩니다. 여러 작업을 병렬로 진행할 때는 먼저 브랜치와 워크트리를 만든 다음(`git worktree add -b feat/new ../new`), 그 위치에서 세션을 시작합니다. 사후 체크아웃 훅은 모든 브랜치 전환과 `git worktree add`를 `.git/ai-usage-branches.log`에 기록하므로, 나중에 제거된 워크트리의 사용량도 집계됩니다. 작업 워크트리를 만들기 전에 훅을 먼저 설정합니다. 클라우드 세션(Claude Code 웹, Codex 클라우드)은 로컬 로그를 남기지 않으므로 기록되지 않습니다.
- 마지막 커밋 이후의 사용량은 다음 커밋에서 집계됩니다. 검토를 요청하기 전에, 그 사이에 에이전트를 실행했다면 한 번 더 커밋합니다.
- `ai-usage/` 파일을 손으로 편집하지 마십시오. `node scripts/ai-usage.mjs report [branch]`가 표를 출력합니다. `AI usage` 워크플로가 각 풀 리퀘스트에 그 결과를 댓글로 올립니다.

## 공유 스킬

프로젝트 스킬은 `.agents/skills/`에 있습니다. 해당 영역에서 작업하기 전에 맞는 `SKILL.md`를 읽습니다.

- `supabase`: Supabase CLI, Auth, 데이터베이스, Storage, Realtime, Edge Functions. 문서는 [supabase.com/llms.txt](https://supabase.com/llms.txt) 색인에서 찾기 시작하며, 색인에 나온 각 페이지는 Markdown으로 가져올 수 있습니다.
- `supabase-postgres-best-practices`: Postgres 스키마, 쿼리, 인덱스, RLS.
- `shadcn`: shadcn/ui 컴포넌트와 설정. 팀이 shadcn/ui를 채택한 경우에 적용합니다.
- `motion`: Motion과 CSS 애니메이션(모범 사례, 문서 검색, CSS 스프링, 성능 감사). Motion AI Kit(`npx motion-ai`, 프로젝트 범위, Claude Code와 Codex)으로 설치했습니다. Claude Code는 `.claude/skills/motion/`의 사본과 `.claude/agents/`의 `motion-reviewer` 에이전트를 사용합니다. 두 에이전트 모두 `.mcp.json`과 `.codex/config.toml`에서 Motion의 호스팅 MCP 서버(`motion`, `motion-plus`)를 받으며, Motion+ 기능은 각자 자신의 에이전트에서 로그인해야 합니다. 업데이트하려면 설치 프로그램을 다시 실행하며, 이 파일들을 덮어씁니다.
- `openspec-*`: 동작 변경을 탐색, 제안, 적용, 보관하기 위해 생성된 핵심 워크플로.

## Supabase 스키마 변경

이 저장소는 `supabase/config.toml`의 `[experimental.pgdelta]`로 활성화된 **pg-delta**를 사용합니다. 원하는 스키마는 `supabase/schemas/`에 두고, 생성된 마이그레이션은 `supabase/migrations/`에 커밋합니다.

1. 테이블, RLS 정책, 권한 부여, 함수, 트리거는 `supabase/schemas/` 아래의 SQL 파일에서 편집합니다. pg-delta가 의존성 순서를 자동으로 정합니다. `[db.migrations].schema_paths`는 설정하지 않습니다.
2. 적용하지 않고 마이그레이션을 생성합니다. `supabase db schema declarative sync --name <short_snake_case_name> --no-apply`를 실행합니다. 로컬 스택을 멈출 필요는 없습니다. 이 명령은 선언형 파일과 마이그레이션 이력을 비교합니다. Studio나 SQL 편집기에서 직접 한 변경은 포착되지 않습니다. `supabase db diff`는 실시간 데이터베이스 상태를 비교하며, 선언형 파일은 읽지 않습니다.
3. `supabase/migrations/`에서 생성된 SQL 파일을 모두 검토합니다. 작업 순서, 권한 부여, 파괴적 변경을 포함합니다. pg-delta는 아직 1.0 이전 버전입니다. 데이터 백필과 지원되지 않는 스키마 변경은 `supabase migration new <name>`으로 만든 별도의 버전 관리 마이그레이션에 둡니다. 시드 데이터는 시드 파일에 둡니다.
4. `supabase start`를 실행한 뒤 `supabase db reset --local`을 실행합니다. 이로써 전체 마이그레이션 체인이 일회용 로컬 데이터베이스를 다시 만드는지 확인합니다. 리셋은 로컬 데이터를 삭제합니다. 스키마 동작이 바뀌면 관련 앱과 데이터베이스 테스트를 실행합니다.
5. 스키마 파일, 생성된 마이그레이션, 변경된 `config.toml`은 함께 커밋합니다. 기존 마이그레이션은 이력으로 취급합니다. 이후 변경에는 새 마이그레이션을 만듭니다.

팀이 대상 환경을 연결하고 식별한 뒤에만 원격 Supabase 프로젝트에 마이그레이션을 배포합니다. `supabase db push`를 실행하기 전에 `supabase db push --dry-run`으로 대기 중인 마이그레이션을 검토합니다.

팀 환경: 각 팀원은 자신의 개인 Supabase 프로젝트와 로컬 `eve dev`에서 개발합니다. 공유 프로젝트 `anelszynxtvxoxqvzgqt`는 `main` 병합 시 CI에서만 마이그레이션을 받으며, Studio를 통해 직접 편집하지 않습니다. 마이그레이션을 생성하려면 Docker가 필요하므로, Docker가 있는 팀원은 같은 풀 리퀘스트 안에서 마이그레이션을 생성합니다. 전체 구조와 릴리스 환경을 추가하는 기준은 [환경과 협업](documentations/technical_specification/03_provider_setup.md#environments-and-collaboration)을 참고하십시오.

참고: [Diff engines](https://supabase.com/docs/guides/local-development/diff-engines), [Declarative database schemas](https://supabase.com/docs/guides/local-development/declarative-database-schemas).
