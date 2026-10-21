> 한국어 번역본 (검토용). 원본: documentations/technical_specification/08_decision_log.md

# Find Me a Time — 결정 기록

상태: 3단계에서 시작. 이후 단계는 각자의 절에 추가\
날짜: 2026-10-22\
관련 문서: [구현 계획](06_implementation_plan.md), [인수 기록](07_acceptance_record.md)

이 기록은 각 단계를 구현하며 내린 모든 결정 지점을 나열하여, 나중에 어느 것이든 다시 검토할 수 있게 합니다. 각 결정마다 선택, 검토한 대안, 결정이 기록된 위치, 바꾸는 방법을 적습니다. 소유 문서가 계속 권위를 가집니다. 변경은 그 단계의 OpenSpec 변경과 델타 명세에서 시작하고, 그다음 여기에 반영합니다. "사용자 대기 항목" 절은 되돌릴 수 없거나 제공자 콘솔에서만 할 수 있어서 진행하지 않은 단계를 나열합니다.

## 3단계 — `requester-intake-and-feasibility`

[제안서](../../openspec/changes/requester-intake-and-feasibility/proposal.md#decisions)가 D1–D13을 기록하고, [설계](../../openspec/changes/requester-intake-and-feasibility/design.md)가 그 근거를 기록하며, [제품 결정](../../openspec/changes/requester-intake-and-feasibility/product_decisions.md)은 검토 체크리스트입니다. Dohyeon Park이 팀원 검토 전인 2026-10-21과 2026-10-22에 D1–D13을 결정했습니다.

### 제품 결정

| # | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| D1 | Google이 경로를 돌려주는 곳이면 어디서나 경로를 계산하며 국가 목록은 없습니다. 각 구간은 간격과 관계없이 같은 현지 날짜의 가장 가까운 일정을 확인합니다. 추정치는 24시간 동안 재사용합니다 | 국가 허용 목록, 대한민국만, 3시간 인접 범위 | 설계 9; `meeting-feasibility` 델타 "Route estimates, geography and freshness" | 둘 다 수정한 뒤 `lib/server/routes-client.ts`(`ROUTE_ESTIMATE_TTL_HOURS`)와 `lib/server/feasibility.ts`의 인접 로직 수정 |
| D2 | 수동 이동 허용 시간은 한 후보의 한 구간을 대상으로 하며, 호스트 구간과 요청자 구간 모두 5분 단위로 5–240분입니다 | 요청별, 출발지·도착지 쌍별, 호스트의 상시 규칙 | 설계 10; `meeting-feasibility` 델타 "Manual travel allowance scope" | 둘 다 수정한 뒤 `travel_allowances`(스키마)와 `lib/server/request-proposals.ts`(`request.allow_trip`) 수정 |
| D3 | 연락처 확인은 선택 사항입니다. 생성 이메일에는 예약 링크와 확인 링크가 담기며, **Confirm this address**를 누르면 확인됩니다. 재전송은 확인된 주소로만 갑니다. 발송: 60초 간격, 요청당 시간당 5건, 주소당 시간당 10건, 하루 1,000건이며 모든 생성 이메일을 셉니다 | 참석자가 쓰기 전에 6자리 코드를 필수로 요구 | 설계 6; `meeting-requests` 델타 "Optional contact confirmation", "Recoverable confirmation email" | `lib/server/contact-confirmation.ts`의 `CONFIRMATION_LIMITS` |
| D4 | `Email Sending: Edit` 토큰을 쓰는 Cloudflare REST API. 증거는 수신자 수락과 `X-Fmat-Dispatch-Id`입니다 | `send_email` 바인딩을 쓰는 Worker 중계 | 설계 5; `email-delivery` 델타 | `lib/server/cloudflare-email.ts` |
| D5 | `evaluate_candidates`는 내구성 있는 애플리케이션 작업으로 실행되며, 도구는 최대 20초 기다립니다 | eve 도구 단계 안에서 평가 | 설계 8 | `lib/server/evaluation.ts`, `lib/server/request-tools.ts` |
| D6 | 온라인 미팅은 대상 캘린더가 허용하면 이벤트와 함께 Google Meet을 받고, 그렇지 않으면 요청자가 제공한 링크를 씁니다 | 호스트가 저장한 링크, 요청자 링크만 | 설계 11; `meeting-requests` 델타 "Online meeting link plan" | `lib/server/request-proposals.ts`; 4단계에서 회의를 생성 |
| D7 | 초안 요청과 요청: 출처당 시간당 5건, 하루 20건, 서비스 전체 하루 500건이며 호스트별 한도는 없습니다 | 호스트별 하루 30건 한도, 더 느슨한 수치 | 설계 2; `meeting-requests` 델타 "Bounded request creation" | `lib/server/request-start.ts`의 `CREATION_LIMITS`와 `DRAFT_LIMITS` |
| D8 | 요청자의 Google 동의는 캘린더 목록 및 읽기 전용 이벤트 범위를 요청하며, 바쁜 시간 규칙과 요청자 본인의 이동에 비공개로 사용합니다. 버튼은 항상 표시됩니다. 허가는 삭제만 가능하며 기본적으로 호스트 OAuth 클라이언트를 재사용합니다(2026-10-22) | 바쁨/한가함만, 게시 전까지 버튼 숨김, 종료 시 별도 클라이언트로 Google에서 철회 | 설계 3; `requester-calendar-access` 델타; PRD FR-12 및 §5 | 범위는 `lib/server/requester-google.ts`; 클라이언트 대체는 그 파일과 `lib/server/requester-calendar.ts`; 종료는 `lib/server/requester-grants.ts` |
| D9 | 로컬 메시징은 루프백 대역 제공자로만 보냅니다 | 로컬 발송 허용, 완전 거부 | 설계 13; `messaging-environments` 델타 | `lib/server/messaging.ts`의 `messagingAdmitted` |
| D10 | 예약 링크는 해시로 조회하고 봉인된 사본으로 보관합니다 | 재전송 때마다 링크 교체 | 설계 7; `meeting-requests` 델타 "Protected request continuation" | `lib/server/booking-links.ts` |
| D11 | `/{handle}`의 어시스턴트 대화로, 처음에는 별도의 익명 접수 아래에 둡니다. D13으로 수정됨 | 정적 접수 페이지 | 설계 2 | D13 참고 |
| D12 | 합의 전 확인. D3으로 철회됨 | — | 제안서 | — |
| D13 | 첫 메시지부터 하나의 게스트 스레드. 메시지가 숨겨진 초안 요청을 만들며, 게스트가 신원을 밝히지 않으면 24시간 뒤 삭제됩니다. 하나의 어시스턴트 세션이 합의까지 이어집니다. 모든 카드는 스레드 안에 있고 실행 가능한 카드는 한 번에 하나입니다. 신원을 밝히면 주소창이 제자리에서 `/booking/{id}`로 바뀝니다 | 별도의 접수 세션을 요청에 이어 붙이기 | 설계 2 및 12; `meeting-requests` 델타 "Continuous guest conversation"; `chat-workspaces` 델타 | `lib/server/request-start.ts`, `lib/server/guest-thread.ts`, `apps/web/app/_components/guest/guest-workspace.tsx` |

### 구현 결정

| 결정 | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| 익명 모델 지출 | 확인된 연락처도 Google 신원도 없는 요청은 초안 요청을 포함해 24시간당 USD 3를 받고 USD 50의 익명 풀에 합산됩니다 | 모든 요청에 전체 USD 30 | 설계 2; `meeting-requests` 델타 | `lib/server/model-limits.ts`의 `MODEL_LIMITS`(`anonymousPrincipalWindowUsd`, `anonymousWindowUsd`) |
| 초안 메시지 한도 | 신원을 밝히기 전 30개 메시지 | 한도 없음, 모델 지출 한도만 | 설계 2 | `lib/server/request-start.ts`의 `DRAFT_LIMITS` |
| 평가 한도 | 같은 리비전에서 실행 중인 평가는 재사용합니다. 요청당 시간당 새 평가는 최대 10건, 이동은 최대 40개 후보까지 확인, 순위는 처음 20개까지 매깁니다 | 무제한 | 설계 8; `meeting-feasibility` 델타 "Bounded evaluations per request" | `lib/server/evaluation.ts`의 `EVALUATIONS_PER_HOUR`와 `RANKING_LIMIT`; `lib/server/feasibility.ts`의 `CANDIDATE_LIMIT` |
| 공유 기한 | 토큰 갱신, Calendar, Routes, 순위 매기기를 합쳐 18초 | — (주 명세가 정함) | `meeting-feasibility` 주 명세 | 명세를 바꾼 뒤 `lib/server/evaluation.ts`의 `EVALUATION_DEADLINE_MS` |
| 대화 수용 | 호스트 또는 요청당 분당 20건, 시간당 100건; 서비스 전체 분당 200건, 시간당 2,000건 | — (주 명세가 정함) | `chat-workspaces` 주 명세 | 명세를 바꾼 뒤 `lib/server/conversation-admission.ts`의 `ADMISSION_LIMITS` |
| 링크 재전송 | 요청당 분당 1건과 시간당 5건, 수신자당 시간당 5건, 서비스 전체 분당 120건과 분당 600회 시도. 공개 응답은 항상 같으며 대조는 대기열에서 처리합니다 | — (주 명세가 정함) | 설계 7 | `lib/server/link-resend.ts`의 `LINK_RESEND_LIMITS` |
| 리비전 | 시간 선택, 협상 중으로의 자동 전환, 신원 확인은 요청 리비전을 올리지 않으며, 대기 중인 검토는 신원 확인을 따라갑니다 | 모든 변경마다 올림 | 설계 4 및 12 | `lib/server/request-proposals.ts`, `lib/server/request-lifecycle.ts`, `lib/server/request-start.ts` |
| 호스트 대기 중 세부 사항 | 요청자가 합의하면 잠깁니다 | 새로 합의하면 수정 가능 | 제품 결정 | `lib/server/request-reviews.ts` |
| 주간 한도 | 후보의 순서만 정합니다. 모든 후보가 가득 찬 주에 있어도 모두 제시합니다 | 호스트가 한도를 면제할 때까지 보류(주 명세 "Only full weeks"), 이는 4단계가 필요 | 제품 결정 | `lib/server/feasibility.ts`; 보관 전에 주 명세와 맞춰 해결 |
| 신원 카드 트리거 | 요청자 도구 `ask_for_identity`가 신원을 요청한 시점을 기록합니다. 카드는 `identity_required`와 메시지 한도에서도 나타납니다 | `draft_request_review`의 플래그 | 설계 12 | `agent/tools/request.ts`, `lib/server/guest-thread.ts` |
| 지금은 건너뛰기 | 요청에 저장됩니다(`calendar_settled_at`) | 탭별 | 설계 12 | `request.set_manual_availability` |
| 가림 처리 | 게스트 입력에서 숫자나 구두점이 있는 8자 이상의 베어러 값, 연결 증명, 자격 증명 URL 매개변수, 예약 링크, 단독 UUID를 제거합니다 | 모든 베어러 단어 제거, 모든 곳에서 단독 UUID 제거 | 설계 14 | `lib/server/redaction.ts` |
| Cloudflare 429 | 불확실이 아니라 거부로 기록 | 불확실로 기록하고 재전송 없음 | 설계 5 | `lib/server/cloudflare-email.ts` |
| 평가 전용 인증 | `createEvalRequesterAuth`는 `FMAT_EVAL_AUDIENCE=requester`일 때만, Vercel 밖의 `eve dev` 안에서 스텁 요청자 평가를 허용합니다 | 오프라인 평가 없음 | 에이전트 구성 | `lib/server/eve-auth.ts` |
| 순위 모델 | 모델 한도를 거치는 `gpt-5.6-terra`; 실제 품질은 검증하지 않음 | 다른 모델 | 설계 8 | `lib/server/evaluation.ts` |
| 폐기된 접수 | 이전 테스트 요청이 기록을 계속 보여 주도록 접수 테이블과 `public_intake` 값을 유지하며, 새로 기록하는 것은 없습니다 | 지금 삭제 | 설계 2 | 열린 요청이 접수를 참조하지 않게 되면 이후 마이그레이션에서 `intakes`를 삭제 |

### 운영 결정

| 결정 | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| 검토 우회 | PR #26과 #27은 사용자의 요청으로 팀원 승인 없이 `--admin`으로 squash 병합했습니다 | 승인을 기다림 | squash 커밋 메시지 | 팀원이 나중에 [제품 결정](../../openspec/changes/requester-intake-and-feasibility/product_decisions.md)을 사용해 검토 |
| 마이그레이션 경로 | 3단계 마이그레이션 세 개를 드라이 런 후 사용자의 승인을 받아, `anelszynxtvxoxqvzgqt`에 연결된 워크트리에서 `supabase db push --linked`로 푸시했습니다. 메인 체크아웃은 예약된 `mriseqztcwmezvtawnbo`에 연결된 채로 두었고 사용하지 않았습니다 | 시크릿이 설정되지 않아 실패하는 `Deploy shared Supabase` 워크플로 | 이 기록; 인수 기록은 아직 갱신해야 함 | 이후 마이그레이션이 CI를 거치도록 워크플로의 저장소 시크릿을 설정 |
| 프로덕션 배포 | 병합할 때마다 `origin/main`의 깨끗한 체크아웃에서 `findmeatime-release`에 연결해 `vercel deploy --prod` | Git 연동 배포(구성되지 않음) | 이 기록 | 자동 배포를 원하면 Vercel 프로젝트를 저장소에 연결 |

### 사용자 대기 항목

다음 단계는 제공자 콘솔, 사람 본인의 계정이나 실제 받은편지함이 필요하거나 되돌릴 수 없어서 진행하지 않았습니다.

- **Google Cloud Console:** 세 개의 `/connections/google/callback` 리디렉션 URI와 `calendar.events.readonly` 범위를 2026-10-22에 추가했고, 리디렉션 URI는 외부에서 확인되었습니다. **아직 열려 있음:** `GOOGLE_MAPS_API_KEY`에 **Routes API**가 활성화되어 있는지 확인하고, 민감한 Calendar 범위에 대한 Google 앱 검증을 제출합니다.
- **Cloudflare 발신자 확인:** `findmeatime.com`의 Email Sending DNS 레코드는 있지만, 아직 통제된 받은편지함으로 보낸 메시지는 없습니다.
- **3단계 프로덕션 증거(작업 7.1):**
  - 팀이 통제하는 받은편지함에서의 생성 이메일과 확인, 재전송된 링크
  - 합의까지의 흐름
  - 테스트 사용자로 **Continue with Google**(AC-27)
  - 키보드 및 휴대폰 너비 확인
  - 이 모두를 [인수 기록](07_acceptance_record.md)에 기록
- **실제 서울 경로 확인(작업 5.2)**과 **실제 모델 평가(작업 6.4):** 비용이 들어서 사용자의 승인 없이는 실행하지 않았습니다.
- D1–D13과 구현 결정에 대한 **팀원 검토**, 그다음 변경의 `openspec archive`.
- **공유 프로젝트 데이터:** 이전 테스트 접수와 요청이 남아 있습니다. 삭제는 공유 프로젝트의 데이터 변경이라 하지 않았습니다.

## 4단계 — `host-review-and-booking`

아직 결정이 없습니다.

## 5단계 — `agent-access`

아직 결정이 없습니다.

## 6단계 — `host-imessage-channel`

아직 결정이 없습니다.

## 7단계 — `requester-email-channel`

아직 결정이 없습니다.

## 8단계 — `operations-and-release`

아직 결정이 없습니다.
