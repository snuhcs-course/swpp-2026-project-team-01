> 한국어 번역본 (검토용). 원본: documentations/technical_specification/02_frontend_architecture.md

# 프론트엔드 아키텍처

날짜: 2026-10-19

상태: 제안된 설계, 구현 보류

참고 문서: [페이지 목록](../user_experience/04_page_list.md)

## 범위와 결정 사항

Next.js App Router, React, TypeScript, npm을 사용하며, 대화 런타임으로는 eve를 의도하고 있습니다. shadcn/ui와 선별된 AI Elements를 UI 방향으로 유지하되, 정확한 버전과 프리셋 호환성은 기반 변경(foundation change)에서 새로 고정(pin)해야 합니다. [Thyme 시각 방향](../../DESIGN.md)을 적용합니다. 아직 패키지, 컴포넌트, 실행 가능한 라우트는 존재하지 않습니다.

UI는 클라이언트에서 안전한 계약과 공유되는 권한 검사 작업에만 의존하며, 테이블, RPC, 함수 URL에 직접 의존하지 않습니다. 워크스페이스를 확장하기 전에 별도로 빌드되는 웹/eve 구성을 확인합니다. [소스 템플릿](#reference-repositories)은 참고용이며, 템플릿의 인증, 영속성, 범용 도구 승인은 제품의 권한 체계를 대체할 수 없습니다.

## 참조 저장소

구현에서는 하나의 기본 템플릿을 복사해 그 위에 Find Me a Time을 만들며, 나머지 저장소는 특정 패턴을 참고하기 위해서만 읽습니다. 어느 것도 의존성이나 호환성 경계가 아닙니다. 검토한 각 리비전은 기반 변경에서 고정하고, 구현 풀 리퀘스트에 소스 커밋을 기록하며, 복사한 코드에는 업스트림 라이선스 고지를 보존합니다. npm을 유지하고, 템플릿의 락파일이나 가변 범위(floating range)를 복사하지 말고 테스트된 의존성 집합을 고정합니다.

### 기본 템플릿

**eve chat template**을 기본으로 복사합니다. 이 템플릿은 이미 합의된 스택(Next.js App Router, React, TypeScript, shadcn/ui, 루트 `vercel.ts`로 구성되며 별도로 빌드되는 서비스로서의 eve)과 일치하고, 최신 eve 릴리스를 따라가며, 규모가 작아서(TypeScript 파일 약 90개, `apps/web` 앱 하나) 다른 템플릿의 제품 기능을 제거하는 것보다 이 템플릿의 신원과 영속성을 교체하는 편이 작업량이 적습니다. 이 템플릿의 시작 모드는 공유 비밀번호, 브라우저 로컬 채팅, 공유 메모리 문서로 구성되고, 프로덕션 모드는 Sign in with Vercel과 Neon, Upstash로 구성됩니다. 실제 호스트 데이터가 앱에 들어오기 전에 두 가지 모두를 Supabase Auth와 우리의 내구성 있는 도메인 저장소로 교체해야 합니다. 라우트 인증만으로는 세션별 소유권이 강제되지 않으며, 이는 우리의 행위자/리소스/대상(actor/resource/audience) 바인딩이 담당합니다.

OpenInstinct도 기본 템플릿 후보로 검토했으나 채택하지 않았습니다. 이 저장소는 완전한 제품(TypeScript 파일 약 440개)으로, 중심에 Kernel 클라우드 브라우저 서브에이전트, 암호화된 비밀번호 보관소, Stripe Link 구매, Linq iMessage, Neon 기반 Better Auth가 있고, pnpm과 Turbo를 사용합니다. 대부분을 삭제해야 하며, eve 고정 버전(0.66.3)도 chat template보다 오래되었습니다. personal-agent template은 Nuxt/Vue이고 memory agent template은 웹 UI가 없으므로, 둘 다 기본 템플릿이 될 수 없습니다.

### 패턴 참조

| 참조 | 용도 | 채택하지 않을 것 |
|---|---|---|
| [eve chat template](https://github.com/vercel/eve/tree/main/apps/templates/eve-chat-template) | 기본 복사본: 루트 `agent/`, `apps/web/`, `useEveAgent` 클라이언트 통합, `/chat/[id]` 재개를 위한 저장된 스트림 이벤트와 세션 커서, 스트리밍 및 메시지 렌더링 | 공유 비밀번호 신원과 공유 메모리/연결 권한 부여, Sign in with Vercel, Neon/Upstash, 제한 없는 도구, pnpm 락파일 |
| [OpenInstinct](https://github.com/Merit-Systems/OpenInstinct) | Next.js 16 + eve 위에서 우리와 가장 가까운 실제 출시 형태: 전화번호로 인증된 사용자를 계정에 매핑하는 iMessage용 eve 채널, 캘린더/Gmail/연락처를 위해 커넥터를 통한 사용자 범위 Google OAuth, 예약 실행, 리비전 검사와 제한된 레코드가 있는 사용자별 메모리 슬롯, 서버 측 요청 범위 지정, 저장소 `AGENTS.md` 규약 | Kernel 브라우저 서브에이전트, 비밀번호 보관소와 자동 채우기, Stripe Link 지갑, Linq 전송 수단(우리는 Photon Spectrum 사용), Better Auth/Neon/Blob, AI Gateway 기본값, Vercel Pro cron 의존성 |
| [personal-agent template](https://github.com/vercel-labs/personal-agent-template) ([eve 모노레포 내](https://github.com/vercel/eve/tree/main/apps/templates/personal-agent-template)에도 있으며 Sendblue iMessage 포함) | 브라우저와 메시징 간의 계정/채널 연동, 웹 서비스와 에이전트 서비스 간 내부 API, 사용자가 승인하는 `save_memory` 제안, 쓰기 도구에 대한 내구성 있는 승인 | Nuxt/Vue 프론트엔드, Better Auth, Sendblue/Slack/Linear 통합, 개인 비서 수준의 권한 |
| [eve memory agent template](https://github.com/vercel-labs/eve-memory-agent-template) | eve 메모리 슬롯의 가장 작은 예시: 검증된 채널 신원에 연결된 사용자별/그룹별 메모리를 분리하고, 매 턴 전에 불러오며, 모델이 언제 저장할 수 있는지 지침을 둠 | Slack 전송 수단, Vercel Blob/Sandbox 저장소, 재사용할 웹 UI 없음 |
| [Vercel chatbot](https://github.com/vercel/chatbot) | 메시지와 입력창(composer) 상호작용, 반응형 완성도, 빈 상태/로딩/오류 상태, 브라우저 테스트 패턴 | Auth.js, 두 번째 사용자 데이터베이스, Neon/Blob 프로비저닝, 게스트 계정, 공개 공유와 업로드, 범용 아티팩트, 모델 선택기 |

이 템플릿들의 메모리 슬롯은 모델이 사용자에 대한 내구성 있는 사실을 기록하게 하지만, Find Me a Time에서 스케줄링 정책은 확인된 설정 명령으로만 기록하므로 메모리 슬롯에 담기는 내용은 기껏해야 권위가 없는 컨텍스트입니다. 어떤 참조도 이메일 전달이나 Photon Spectrum iMessage 전송 수단을 제공하지 않으며, 사이드바가 없는 [워크스페이스 계약](../../openspec/specs/chat-workspaces/spec.md)을 무효화하는 참조도 없습니다.

## 소스 구성

다음 경로는 향후의 레이아웃이며 현재 존재하는 파일이 아닙니다.

```text
agent/                      eve definition, instructions, tools and channel adapters
apps/web/                   Next.js routes, feature UI and web-specific adapters
lib/contracts/              browser-safe schemas, actions and audience projections
lib/server/                 shared identity, onboarding, scheduling, booking, delivery
lib/server/providers/       narrow Calendar, Routes and messaging adapters
lib/server/db/              transactions and repositories
lib/server/jobs/            durable dispatch and reconciliation
tests/integration/          cross-module, database and runtime verification
tests/e2e/                  browser journeys
supabase/schemas/           future desired application schema
supabase/migrations/        reviewed future migration chain
supabase/tests/             grants, invariants and concurrency tests
```

단위 테스트는 모듈 옆에 둡니다. 독립적으로 배포되는 패키지, 새로운 워커 앱, 브리지 배포는 측정된 런타임 필요가 생길 때까지 미룹니다. 루트 빌드/배포 설정은 기반 검증이 통합 형태를 선택한 뒤에 도입합니다. 이 기획 단계의 체크아웃에는 자리 표시용 애플리케이션 디렉터리가 필요하지 않습니다.

## 논리적 경계

서버 진입점은 인증, 권한 확인, 검증을 수행한 뒤 위임합니다. eve 도구는 웹, MCP, 사용자 CLI, 검증된 채널과 동일한 도메인 작업을 호출하며, 세션 대상별로 등록됩니다([권한 계층](04_agent_configuration.md#permission-layers)). 공급자 자격 증명, 권한이 높은 영속성, 모델 설정은 서버 전용으로 유지합니다. 계약 모듈은 브라우저 빌드와 서버 빌드 양쪽에서 안전해야 하며, 직접 import뿐 아니라 간접/재내보내기(re-export) import도 확인합니다.

대상(audience)별로 필터링된 서버 스냅샷만 렌더링합니다. React는 로컬 상호작용을 처리하며, 호스트 자격, 합의, 승인, 실현 가능한 후보, 예약 결과를 결정하지 않습니다. 런타임 이벤트와 모델 텍스트는 액션 카드의 권한을 만들어낼 수 없습니다.

## 렌더링과 상태 소유권

| 상태 | 권한 주체(authority) |
|---|---|
| 호스트 신원, 자격, 권한 부여, 채널 바인딩 | 현재 서버 검증 |
| 요청, 제안, 결정, 후보 증거, 예약 | 내구성 있는 리비전 관리 도메인 상태 |
| 대화/런타임 바인딩과 커밋된 입력 | 내구성 있는 실행이 뒷받침하는 애플리케이션 소유 범위 |
| 대화 기록(transcript)과 액션 카드 | 승인된 대상(audience)에 대한 투영 |
| 입력창 텍스트, 열린 대화상자, 저장되지 않은 컨트롤 편집 | 로컬 React 상태 |

안정적인 메시지/아티팩트 식별자, 리비전을 인식하는 명령, 정확한 재시도 식별자를 사용합니다. 비공개 대화 기록과 베어러/공급자 자격 증명은 브라우저 로컬 스토리지에 영속화하지 않습니다. 로그아웃, 행위자 변경, 철회 시에는 보호된 스냅샷을 지웁니다. 공유 캐시에는 비공개 HTML, 응답, 스트림이 절대 들어가서는 안 됩니다.

## 신원과 대화 선택

하나의 호스트 워크스페이스 `/app`이 접근, 설정, 요청 선택, 검토, 설정 관리를 담당합니다. 설정 대화, 호스트 비공개 요청 논의, 공유/요청자 논의는 서로 구분해서 유지합니다. 요청 ID를 선택하면 소유권을 확인한 뒤에야 컨텍스트가 바뀝니다. 알림 링크, 새로고침, 브라우저 동의는 URL을 증명으로 취급하지 않고 승인된 범위를 복원합니다.

공개 접수는 `/{handle}`을 사용하고, `/booking/[bookingId]`는 예약 전후의 보호된 요청을 이어갑니다. 사용자에게 보이는 예약 ID는 공급자의 이벤트 ID가 아니라 요청으로 해석됩니다. URL의 무작위 예약 식별자가 요청자의 자격 증명이므로, 페이지는 `Referrer-Policy: no-referrer`를 보내고, 색인에서 제외되며, 식별자를 공유 캘린더 설명이나 전체 요청 로그에 절대 기록하지 않습니다. 핸들을 해석하기 전에 프로토콜/애플리케이션 라우트 이름을 예약해 둡니다.

## 안내형 게스트 접수

신원과 가용 시간 전용 Calendar 접근을 한 화면에서 요청하는 선택적 Google 미리 채우기와 수동 진행을 제공합니다. Calendar 부분을 거부해도 신원은 미리 채워지며, 요청 범위 캘린더 동의는 나중에 부여할 수 있습니다. 편집 가능한 감지된 IANA 시간대, 날짜별 오프셋, 제공된 세부 정보를 보존합니다. 추출된 변경 사항은 적용 전에 검토하며, 모호한 날짜, 소요 시간, 대면 장소는 합의 전에 해결합니다. 연락처 증명과 복구는 채팅이나 모델의 입력이 아니라 보호된 컨트롤로 유지합니다.

## 호스트 설정 대화

[호스트 온보딩 흐름](../user_experience/05_host_onboarding_flow.md)은 상태와 서버 확인을 기록하고, [에이전트 구성](04_agent_configuration.md)은 대화 런타임이 정의되는 방식을 기록합니다. 설정은 에이전트의 안내와 간결한 채팅 내 카드로 이끌어 갑니다. 실제 충돌 캘린더를 먼저 제안하고 이어서 쓰기 가능한 예약 대상 캘린더를 제안하며, 선택을 설명하고 편집하고 확정합니다. 저장된 충돌 캘린더를 과거/다음 4주에 걸쳐 자동으로 분석하고, 범위와 제한된 실패를 공개하며, 증거 기반 선호 또는 라벨이 붙은 시작용 선호를 제시합니다. 여기에는 선호 시간대, 제안 상한이 포함된 주간 미팅 부하, 제외할 메모성 이벤트, 가장 빈번한 지역과 장소가 있으며, 각각 표본 수와 함께 질문 형태로 제시됩니다. **다시 분석(Analyze again)**은 복구/새로고침 동작이며, 첫 번째 스캔을 위해 별도로 필요한 두 번째 동의가 아닙니다.

미팅 모드/장소를 명시적으로 묻고, 앞서 명시한 답변은 다시 사용합니다. 대면/둘 다 가능 모드에는 이동수단 또는 이동 1회당 정책과 추가 이동 버퍼가 필요하며, 온라인 전용에서는 이 컨트롤을 건너뜁니다. 제안과 타이핑한 수정은 초안을 업데이트합니다. 저장된 정책/공개 전에 현재의 최종 검토, 명시적 확인, 서버 준비도 검사를 거칩니다.

iMessage 연결 카드는 인라인으로 유지합니다. 회선 번호, **코드 복사(Copy)**와 메시지 앱에 코드가 이미 입력된 상태로 열리는 **메시지 앱 열기(Open Messages)** 딥링크를 갖춘 일회용 연결 코드, 마스킹된 발신자 확인, 전화번호 입력과 6자리 증명을 담은 **대신 코드 받기(Send me a code instead)** 대체 경로, 연결 요약, 선택적 건너뛰기로 구성됩니다. 브라우저 로그인과 Google 동의는 보호된 핸드오프를 사용하며, 돌아오면 같은 초안이 복원됩니다. 코드 입력 필드는 대화 기록과 모델 컨텍스트 밖에서 보호된 서버로 직접 제출합니다. 비공개 채널의 설정 확인에는 별도로 검토되는 델타와 만료되는 현재 검토 컨텍스트가 필요합니다.

## 명령, 아티팩트, 사람의 결정

카드는 현재 리비전과 허용된 동작을 가진, 타입이 지정된 허용 목록(allowlist) 기반 투영입니다. 후보 선택, 요청자 합의, 호스트 승인, 예약 디스패치, 확정된 영수증을 구분합니다. 확인은 현재의 제안/설정 검토를 식별해야 하며, 모델의 문장, OAuth 권한 부여, 전달 영수증으로는 충분하지 않습니다.

모델이 실패해도 구조화된 컨트롤은 계속 사용할 수 있어야 합니다. 오래된 카드는 조용히 더 새로운 상태를 변경하지 않고 새로고침됩니다. 보류 중인 명령은 응답 유실과 상태 조회 시에도 재시도 식별자를 재사용하며, 불확실한 결과를 근거로 자동 재전송을 만들지 않습니다.

## 스트리밍과 채널 간 업데이트

모든 런타임의 생성/읽기/목록/스트림/입력/제어 라우트를 인가하고, 도구와 스트림 전달에서 권한을 다시 확인합니다. 기본 런타임 엔드포인트는 닫힌 상태로 실패합니다. 재연결은 승인된 커서에서 이어가며, 종료 복구(terminal recovery)는 커밋된 입력, 기록, 누적 사용량, 현재 범위를 보존하는 별도의 명시적 전이입니다. 상태가 없다고 해서 조용히 대체 세션을 만들지 않습니다.

하나의 커밋된 대화 기록 투영을 사용하고 메시지 애니메이션/재생이 중복되지 않도록 합니다. 완료된 저작(authored) 온보딩 메시지는 다시 방문할 때 즉시 표시되며, 모션 감소를 설정한 사용자에게는 전체 텍스트를 제공합니다. 브라우저 복구는 저장되지 않은 초안과 접근 가능한 카드를 보존하며, 실패했거나 불확실한 공급자 작업이 성공했다고 주장하지 않습니다.

## 접근성과 검증

휴대폰 화면 폭, 200% 확대, 키보드 전용 상호작용, 모션 감소, 강제 색상(forced colors), 포커스 복원을 확인합니다. 모바일 키보드가 열려도 입력창과 동작 버튼에 접근할 수 있도록 유지하며, 시간대와 상태는 색상 외의 방법으로도 읽을 수 있어야 합니다. 레이블이 있는 컨트롤과 절제된 알림 안내를 사용합니다. 접근 권한을 잃은 뒤에는 로컬에 저장되지 않은 초안 텍스트만 선택/폐기 동작과 함께 남기고, 보호된 서버 데이터는 제거합니다.

호스트 2명/요청자 2명 간의 격리, 인가되지 않은 원시 라우트, 보호된 import 경계, 콜백/새로고침 복구, 오래된/동시 동작, 재연결 대 종료 복구, 모델 실패, 전체 스케줄링 여정을 검증합니다. 의존성을 고정하고, 기반 구현과 함께 문서화된 앱 빌드/검사 명령을 도입합니다. 픽스처와 통제된 공급자/디바이스 검사는 서로 다른 증거를 제공하며, 어느 쪽도 다른 쪽을 대체하지 않습니다.
