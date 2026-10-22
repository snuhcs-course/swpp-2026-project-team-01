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
| 검토 우회 | PR #26, #27, #28은 사용자의 요청으로 팀원 승인 없이 `--admin`으로 squash 병합했습니다 | 승인을 기다림 | squash 커밋 메시지 | 팀원이 나중에 [제품 결정](../../openspec/changes/requester-intake-and-feasibility/product_decisions.md)을 사용해 검토 |
| 마이그레이션 경로 | 3단계 마이그레이션 다섯 개를 `anelszynxtvxoxqvzgqt`에 `supabase db push --linked`로 푸시했으며, 매번 드라이 런 후 사용자의 승인을 받아 해당 프로젝트에 연결된 워크트리에서 실행했습니다. PR #26 뒤인 2026-10-22에 세 개, PR #28 뒤인 2026-10-22에 `guest_draft_requests`와 `guest_calendar_step`입니다. 메인 체크아웃은 예약된 `mriseqztcwmezvtawnbo`에 연결된 채로 두었고 사용하지 않았습니다 | 시크릿이 설정되지 않아 실패하는 `Deploy shared Supabase` 워크플로 | 이 기록; [인수 기록](07_acceptance_record.md#production-deployment-2) | 이후 마이그레이션이 CI를 거치도록 워크플로의 저장소 시크릿을 설정 |
| 프로덕션 배포 | PR #26, #27, #28 각각을 병합한 뒤 `origin/main`의 깨끗한 체크아웃에서 `findmeatime-release`에 연결해 `vercel deploy --prod`; 게스트 스레드 코드는 마이그레이션이 적용된 뒤에야 라이브가 되었습니다 | Git 연동 배포(구성되지 않음) | 이 기록; [인수 기록](07_acceptance_record.md#production-deployment-2) | 자동 배포를 원하면 Vercel 프로젝트를 저장소에 연결; 그때까지는 마이그레이션이 필요한 변경을 배포하기 전에 마이그레이션을 먼저 푸시 |

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

[제안서](../../openspec/changes/host-review-and-booking/proposal.md#decisions)가 D1–D12를 기록합니다. 구현을 맡은 세션이 사용자의 지시(모든 결정을 기록하고 바꿀 수 있게 유지)에 따라 2026-10-22에 이를 정했으며, 아직 팀원 검토를 받은 결정은 없습니다.

### 제품 결정

| # | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| D1 | 이벤트는 호스트 본인의 Google 권한 부여로 호스트가 확인한 예약 대상 캘린더에 생성되므로, 주최자는 Google이 보고하는 그 캘린더의 소유자입니다. 요청자만 참석자입니다 | 양쪽 모두를 초대하는 서비스 소유 캘린더 | 제안서 | 제안서와 이벤트 빌더 |
| D2 | 첫 디스패치 후 15분이 지나도 확정되지 않은 예약은 요청자에게 "아직 진행 중" 이메일을 한 번 보냅니다 | 5분; 1시간 | 제안서 | 제안서 |
| D3 | 리마인더는 미룹니다. 서비스는 리마인더나 후속 이메일을 보내지 않으며, 이벤트는 캘린더의 기본 알림을 유지합니다 | 24시간 전 서비스 리마인더 이메일 | 제안서; PRD 10절 | 제안서, 그다음 새 작업과 템플릿 |
| D4 | 이벤트 ID는 예약 ID에서 도출해 디스패치 전에 저장하므로, Google이 두 번째 삽입을 거부하고 재조정은 ID로 이벤트를 읽습니다 | Google이 부여하는 ID | 제안서 | 제안서와 이벤트 빌더 |
| D5 | Google이 자체 초대장을 보냅니다(`sendUpdates=all`). 우리 확인 이메일은 그 뒤에 보냅니다 | `sendUpdates=none`에 우리 캘린더 파트만 사용 | 제안서 | 제안서와 이벤트 빌더 |
| D6 | 호스트의 **공유됨(Shared)** 보기는 제안과 상태가 담긴 읽기 전용 요청자 대화이며, 호스트는 거기서 카드로만 행동합니다 | 호스트 메시지를 요청자 스레드로 전달 | 제안서 | 제안서와 호스트 요청 보기 |
| D7 | **변경 요청(Request changes)**과 `propose_shared_changes`는 대기 중인 제안 하나를 만들고, **수정된 내용 공유(Share revised details)**가 이를 적용하고 시간을 확인한 뒤 다음 제안 버전을 기록합니다 | 실현 가능성 확인 없이 공유 | 제안서 | 제안서와 공유 변경 모듈 |
| D8 | 모든 후보가 가득 찬 주에 걸리면, 호스트가 해당 요청의 주간 한도를 면제하거나 요청자가 기간을 넓힐 때까지 아무것도 제시하지 않습니다(주 명세 "Only full weeks"). 3단계의 순서만 정하던 동작을 대체합니다 | 순서만 정하는 동작 유지 | 제안서 | 제안서와 평가 작업의 요청자 프로젝션 |
| D9 | 디스패치가 시작되었을 수 있는 시점 이후에는 작업이 이벤트 ID로 재조정하고 고정된 페이로드를 같은 ID로 다시 삽입하기만 하며, 실현 가능성을 다시 검증하지 않습니다. 8번 시도한 뒤 **예약 진행 중(Booking in progress)**과 **예약 상태 확인(Check booking status)**을 표시합니다 | 재시도마다 다시 검증 | 제안서 | 제안서와 예약 작업 |
| D10 | 양쪽 모두 확인을 받습니다. 요청자의 Reply-To는 호스트의 Google 이메일이고, 호스트의 Reply-To는 확인 여부와 관계없이 요청자의 연락처 주소입니다 | 확인 후에만 Reply-To | 제안서; `email-delivery` 델타 | 제안서와 확인 빌더 |
| D11 | 상태 이메일은 확인 여부와 관계없이 요청자의 연락처 주소로 보냅니다 | 확인된 주소만 | 제안서; `email-delivery` 델타 | 제안서와 알림 모듈 |
| D12 | 호스트는 `/app?request={requestId}`에서 요청을 열며, 예약 UUID는 호스트에게 전달되지 않습니다 | 인터페이스 문서의 `/app?request={bookingId}` | 제안서; 인터페이스 | 제안서와 호스트 워크스페이스 |

### 구현 결정

| 결정 | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| 재검증 범위 | 예약 재검증은 호스트 쪽만 다시 확인합니다. 새로 읽은 호스트 Calendar, 한 시간이 지나지 않은 경로 추정, 호스트의 다른 발송 중·확정 예약을 바쁜 시간으로 봅니다. 요청자가 그 시간에 동의했으므로 요청자의 캘린더는 다시 읽지 않습니다 | 요청자의 캘린더를 다시 읽기, 이 경우 요청자 읽기 실패가 예약을 막게 됨 | 설계 6 | `lib/server/bookings.ts`의 `checkInterval` 옵션(`requesterCalendar: false`) |
| 예약 잠금 | 요청 행, 이어서 호스트별 권고 잠금 `app.booking_host:{hostId}`를 재검증(최대 18초)과 발송 표시 동안 유지합니다 | 호스트 잠금 없이 캘린더에만 의존 | 설계 6 | `lib/server/bookings.ts`의 `lockHost` |
| 예약 시도 | 대기열의 배가 백오프로 8회 시도한 뒤, **예약 상태 확인(Check booking status)**을 누를 때까지 **예약 진행 중(Booking in progress)**; 작업자 배치당 예약 작업은 최대 3건 | 무제한 재시도 | 설계 7 | `lib/server/bookings.ts`의 `BOOKING_ATTEMPTS`; `lib/server/job-handlers.ts`의 `JOB_BATCH_LIMITS` |
| 반복 승인 | 같은 버전을 재시도 키와 관계없이 다시 승인하면 현재 예약을 돌려줍니다 | 오래된 요청으로 거부 | `calendar-booking` 델타 | `lib/server/bookings.ts`의 `approveCommand` |
| 예약 시점의 오래된 결정 | 최신 버전을 가리키지 않는 승인이나 합의는 예약을 `stale_decision`으로 실패시키고 요청을 승인 대기로 되돌립니다 | 충돌로 처리 | 설계 7 | `lib/server/bookings.ts`의 `claimBooking` |
| 발송 후 알 수 없는 오류 | 발송 표시 이후의 토큰 갱신 실패나 전송 오류는 불확실로 보고 대조하며, "보내지 않음"으로 처리하지 않습니다 | 확정으로 처리 | 설계 7 | `lib/server/bookings.ts`의 `write` |
| 이벤트 ID 제약 | `^[0-9a-v]{5,}$`에 길이 검사 1024 이하; Postgres 정규식이 반복 횟수를 255로 제한하기 때문입니다 | 패턴에 `{5,1024}` | `supabase/schemas/app/tables/bookings.sql` | 스키마 파일과 새 마이그레이션 |
| 새 오류 범주 | 발송이 시작됐을 수 있는 뒤의 철회, 거절, 변경에 대한 `booking_pending` | `request_closed` 재사용 | `lib/contracts/command-errors.ts` | 계약과 경로 상태 맵 |
| 링크 없는 알림 | 요청자의 봉인된 예약 링크를 열 수 없으면(폐기된 키) 상태 이메일이나 확인을 기록하지 않으며, 도메인 변경은 그대로 커밋됩니다 | 변경을 실패시킴 | `lib/server/booking-notices.ts` | 그 파일의 `requesterBookingUrl` |
| 공유 변경 확인 | 공유 제안은 고정 간격의 일반 평가 작업으로 확인하며, 그 하나의 후보가 다음 제안이 됩니다 | 별도의 확인 작업 | 설계 4 | `lib/server/shared-change-settle.ts`의 `settleSharedChange`; `lib/server/evaluation.ts`의 `interval` 페이로드 |
| 호스트 논의 범위 | `/api/chat/*`는 선택적 `request`(UUID)를 받으며, 다른 호스트의 요청, 초안, 알 수 없는 ID, 형식이 잘못된 ID는 모두 404 `request_unavailable`로 답합니다 | 별도의 `/api/host/requests/{id}/messages` 경로 | 설계 2 | `lib/server/chat-routes.ts`의 `requestScope`; `lib/server/conversations.ts`의 `lockHostDiscussion` |
| 호스트 검토 허용 한도 | 호스트 검토 메시지는 설정과 같은 호스트별 허용 구간에 함께 집계됩니다 | 요청마다 별도의 구간 | 설계 2 | `lib/server/conversations.ts`의 `recordInput` |
| 호스트 모델 투영 | 요청자의 이름과 목적은 인용된 문자열로, 연락처 이메일은 `present`로, 시간은 호스트의 시간대로 모델에 전달됩니다 | 원본 값 | 설계 12 | `lib/server/host-review-tools.ts`의 `hostModelProjection` |
| 요청 화면 이동 | 메뉴에 **요청(Requests)**이 추가됩니다. `/app?view=requests`는 받은 요청함, `/app?request={requestId}`는 개별 요청이며 모두 같은 `/app` 페이지 안에 있습니다. 알 수 없거나 다른 호스트의 요청은 "That request is not available." 안내와 함께 받은 요청함으로 돌아갑니다 | 별도의 `/app/requests` 경로 | 설계 3; 페이지 목록 | `apps/web/app/_components/host-workspace.tsx`의 `HostWorkspace` |
| 논의 전환 | 탭 두 개, **Thyme과 비공개(Private with Thyme)**와 **{requester}와 공유(Shared with {requester})**를 화살표 키로 전환합니다. 공유 탭은 기록된 이벤트에서 읽은 요청자 대화 내역이며 실시간으로 따라가지 않습니다 | 실시간으로 따라가는 공유 화면 | 설계 2 | `apps/web/app/_components/host/host-requests.tsx`의 `RequestView`와 `SharedConversation` |
| 열린 카드 순서 | 실행할 수 있는 카드는 하나만 보입니다. 대기 중이거나 확인 중인 제안이 먼저이고, 그다음 진행 중인 예약이나 재시도할 수 있는 실패, 그다음 보류가 있거나 해결되지 않은 이동이 있는 동안의 규칙 및 이동 검토, 마지막으로 제안서 검토입니다 | 모든 카드를 한꺼번에 보여주기 | 설계 3 | `apps/web/app/_components/host/host-request-cards.tsx`의 `nextHostStep` |
| 제안 편집기 | 시간은 호스트의 시간대로 입력하고, 길이는 15분에서 480분까지 5분 단위입니다. 존재하지 않는 현지 시간은 브라우저에서 거부하고, 두 번 나타나는 시간은 더 이른 시점을 씁니다 | 자유 입력 시간 | 설계 4 | `SuggestionEditor`; `lib/contracts/timezone.ts`의 `instantFromLocal`; `lib/server/shared-changes.ts`의 `sharedChangesSchema` |
| 정산 폴링 | 예약, 제안 확인, 평가가 대기 중인 동안 요청 화면은 3초마다 폴링합니다 | 푸시 업데이트 | 설계 3 | `host-requests.tsx`의 `SETTLING_POLL_MS` |
| 예약 중인 요청자 | 스레드의 상태 줄이 **예약 진행 중(Booking in progress)**과 **예약 상태 확인(Check booking status)**으로 바뀝니다. 예약이 끝난 요청의 링크에는 상태와 요청자의 시간대로 된 영수증만 보입니다 | 예약 뒤에도 대화를 열어 두기 | 설계 10 | `apps/web/app/_components/requester/cards.tsx`의 `AwaitingLine`; `apps/web/app/booking/[bookingId]/page.tsx`의 `Closed` |
| 이메일 회신 안내 | 확인 메일은 지원 주소 대신, 회신하면 상대 참석자에게 전달된다고 안내합니다. 지원 주소는 아직 정해지지 않았기 때문입니다 | 지원 주소 | 설계 9 | `lib/server/booking-emails.ts`의 `LABELS` |
| 호스트 안내문 언어 | 호스트의 확인 메일은 영어로, 호스트의 시간대로 보냅니다 | 요청자의 언어 | 설계 9 | `lib/server/booking-notices.ts`의 `enqueueConfirmations` |

### 운영 결정

| 결정 | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| 하나의 커밋으로 낸 B 레인 | B 레인 계획 항목 세 개를 하나의 커밋으로 냈습니다. 예약, 발송, 대조가 하나의 모듈이자 하나의 작업이기 때문이며, 이 커밋에는 평가 작업이 가져다 쓰는 A 레인의 공유 변경과 예외용 서버 모듈, 그리고 새 논의 키가 요구하는 호스트 논의의 요청 범위도 들어 있습니다 | 반쪽을 스텁으로 둔 커밋 세 개 | 이 기록; 커밋 메시지 | 이후 변경에서 필요하면 모듈을 나눔 |
| 하나의 커밋으로 낸 A 레인 카드 | 선택 카드와 전환, 제안서 카드와 제안 카드, 규칙 및 이동 검토를 함께 냈습니다. 하나의 화면, 하나의 카드 모듈, 하나의 브라우저 테스트를 공유하기 때문입니다 | 커밋 세 개 | 이 기록 | — |
| 이벤트 생성에 따른 참조 | OpenInstinct `agent/lib/google-workspace/calendar.ts` `0c2a7c6e`: 32자리 16진수 이벤트 ID, 참석자가 있을 때 `sendUpdates: "all"`, `409`는 `events.get`으로 다시 읽기 | Google이 지정하는 ID | 풀 리퀘스트 | — |

### 사용자 대기 항목

다음 단계는 되돌려도 취소할 수 없거나, 제공자 콘솔이 필요하거나, 팀 밖의 사람에게 발송되기 때문에 수행하지 않았습니다.

- **공유 프로젝트 마이그레이션:** `20261022021159_host_review_and_booking.sql`은 `anelszynxtvxoxqvzgqt`에 없습니다. 먼저 드라이런을 보여 준 뒤, 사용자의 승인을 받아 배포 워크플로나 `supabase db push --linked`로 적용해야 합니다. 3단계를 포함한 이전 마이그레이션 21개는 이미 그곳에 적용되어 있으므로(인수 기록, 3단계) 대기 중인 것은 이것 하나뿐입니다. 이 브랜치를 배포하기 전에 푸시해야 합니다.
- **프로덕션 배포:** 병합된 뒤 이 브랜치의 배포.
- **통제된 Google Calendar 증거:** 팀이 통제하는 Google Calendar의 예약. `sendUpdates=all`은 Google이 참석자에게 이메일을 보내게 하므로 요청자 주소는 팀 받은편지함이어야 합니다.
- **통제된 받은편지함 증거:** 팀 받은편지함에서의 확인 사본 두 개와 상태 이메일 하나, `text/calendar` 첨부 파일이 Gmail과 Outlook에서 초대로 보이는지 포함.
- **병합:** 풀 리퀘스트에는 팀원의 승인이 필요하며, 관리자 우회는 사용하지 않았습니다.
- **팀원 검토:** D1–D12와 구현 결정에 대한 검토, 이어서 변경의 `openspec archive`.

## 5단계 — `agent-access`

[제안서](../../openspec/changes/agent-access/proposal.md#decisions)가 D1–D16을 기록하고 [설계](../../openspec/changes/agent-access/design.md)가 그 근거를 기록합니다. 구현 세션이 2026-10-22에 모든 결정을 기록하고 변경 가능하게 유지하라는 사용자의 지시에 따라 이를 정했으며, 아직 팀원 검토를 받은 결정은 없습니다.

### 제품 결정

| # | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| D1 | 역할별 MCP 엔드포인트 하나가 두 프로토콜 세대를 모두 처리합니다: 요청별 메타데이터를 쓰는 `2026-07-28`, 그리고 상태 비저장 `initialize`를 통한 `2025-11-25`, `2025-06-18`, `2025-03-26`. JSON 응답과 도구만 지원합니다 | `2026-07-28`만; `2025-11-25`만 | 제안서; 설계 6; `agent-interfaces` 델타 | 제안서와 MCP 핸들러의 프로토콜 버전 |
| D2 | 클라이언트 ID 메타데이터 문서를 우선하고, 이를 쓰지 않는 클라이언트에는 동적 클라이언트 등록, 그리고 사전 등록된 `fmat-cli` | 동적 등록만; 메타데이터 문서만 | 제안서; 설계 3; `agent-client-authorization` 델타 "Bounded client registration" | 제안서, 인가 서버 메타데이터, 클라이언트 리졸버 |
| D3 | 스코프 `host:read`, `host:write`, `host:decide`, `request:read`, `request:write`, `request:decide`; 각 리소스는 자기 역할의 스코프만 받으며 동의 시 좁힐 수 있습니다 | 도구별 스코프 하나; 읽기-쓰기 스코프 하나 | 제안서; 설계 4; `agent-client-authorization` 델타 "Role-bound permission scopes" | 제안서, 델타, 계약의 스코프 표 |
| D4 | `cli/`의 `@findmeatime/cli`가 제공하는 CLI `fmat`, Node.js 20 이상, 의존성 없음; macOS Keychain과 Linux Secret Service; Windows는 파일 저장소만 지원하며 테스트하지 않음 | Go 또는 Rust 바이너리; 명령어 `findmeatime` | 제안서; 설계 9; CLI 방향 | 제안서와 `cli/` |
| D5 | 호스트는 `{origin}/mcp`, 요청자는 `{origin}/{handle}/mcp`를 쓰며, 토큰은 정확한 리소스에 바인딩됩니다 | 호스트 매개변수를 쓰는 단일 리소스 | 제안서; 설계 2 | 제안서, 라우트, 리소스 파서 |
| D6 | Ed25519 JWT 액세스 토큰 10분; 사용 시 회전하는 불투명 리프레시 토큰 30일; 코드 60초; 키 `AGENT_TOKEN_SIGNING_KEY` | 불투명 액세스 토큰; RS256 | 제안서; 설계 5 | 제안서와 토큰 모듈의 토큰 수명 |
| D7 | 동의 화면에서 시작한 로그인은 트랜잭션을 HTTP 전용 쿠키에 보관하며, 콜백은 살아 있는 트랜잭션일 때만 그곳으로 돌아가고 아니면 `/app`으로 갑니다 | `next` 쿼리 매개변수 | 제안서; 설계 7; `chat-workspaces` 델타 | 델타와 `google-sign-in.ts` |
| D8 | `/connect/authorize`는 프로토콜 라우트이고 페이지는 `/connect/consent`입니다 | 라우트 핸들러가 HTML을 렌더링하는 단일 URL | 제안서; 설계 7; 페이지 목록 | 제안서와 라우트 |
| D9 | 호스트의 승인과 거절에는 항상 `/app`에서의 호스트 클릭이 필요하며, 에이전트의 결정 도구는 검토 링크를 반환합니다 | 클라이언트의 엘리싯테이션으로 승인 | 제안서; 설계 4; `agent-interfaces` 델타 | 제안서와 호스트 결정 도구 |
| D10 | `request:decide`를 가진 요청자의 에이전트는 동의와 철회를 할 수 있습니다 | 동의는 요청자의 브라우저에서 | 제안서; 설계 4 | 제안서와 요청자 도구 |
| D11 | 종료된 요청의 허가는 종료 상태와 영수증만 읽을 수 있고, 예약 링크의 종료 후 접근 수명이 끝날 때까지 그 용도로만 갱신됩니다 | 주 명세대로 종료 시 모든 접근 거부 | 제안서; 설계 5; `agent-client-authorization` 델타 | 델타와 허가 검사 |
| D12 | 부트스트랩 허가는 24시간 유지됩니다. `create_request`는 요청 하나를 만들고 식별하며, 예약 링크를 이메일로 보내고, 같은 재시도 키에는 같은 요청을 반환하고 다른 키는 거부합니다. 생성은 동의한 브라우저의 출처 한도에 포함됩니다 | 동의 시점에 바인딩 | 제안서; 설계 8; `agent-client-authorization` 델타 "One future request grant" | 델타와 생성 모듈 |
| D13 | 요청자 동의 페이지는 기존 요청도 예약 링크로 연결하며, 같은 호스트만 허용합니다 | 예약 페이지의 연결 버튼 | 제안서; 설계 8 | 제안서와 동의 페이지 |
| D14 | 헤드리스 CLI 로그인은 코드를 `{origin}/connect/code`에 표시합니다 | 디바이스 인가 그랜트 | 제안서; 설계 9 | 제안서, 퍼스트파티 클라이언트, 페이지 |
| D15 | 리디렉션 URI: 스킴, 호스트, 경로, 쿼리가 정확히 일치; `https` 또는 루프백 `http`; 루프백 IP 리터럴은 포트가 달라도 됩니다 | 루프백에도 정확한 포트 | 제안서; 설계 3 | 제안서와 리디렉션 매처 |
| D16 | 배포 후 프로덕션에서 클라이언트별 실행. 팀 호스트 계정과 팀 요청자 수신함을 쓰고, 각 클라이언트는 팀원 계정 아래 현재 버전으로 실행하며, 결과는 인수 기록에 남깁니다 | 스테이징 배포; SDK 픽스처 | 제안서; 설계 11 | 제안서와 클라이언트별 메모 |

### 구현 결정

| 결정 | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| 재전송 대응 | 재전송된 코드나 리프레시 토큰은 허가 전체를 철회하므로, 그 동의의 액세스 토큰은 리프레시 계열만이 아니라 다음 호출부터 모두 멈춥니다 | 계열만 철회, 이 경우 모든 액세스 토큰에 계열을 담아야 합니다 | `agent-grants.ts` | `lib/server/agent-grants.ts`의 `exchangeCode`와 `refreshTokens` |
| 리프레시 경계 | 계열의 30일은 코드 교환 시점에 시작해 움직이지 않습니다. 회전해도 만료가 유지되므로 호스트는 최소 한 달에 한 번 다시 연결합니다 | 회전마다 30일 슬라이딩 | `agent-grants.ts` | `lib/server/agent-grants.ts`의 `issueTokens`와 `REFRESH_DAYS` |
| 등록 인증 방식 | 등록은 요청된 `token_endpoint_auth_method`를 모두 받아들이고 RFC 7591이 허용하는 대로 `none`으로 답합니다. 클라이언트 시크릿은 없습니다 | 기밀 클라이언트 요청 거부 | `agent-clients.ts` | `lib/server/agent-clients.ts`의 `registerClient` |
| 리소스 오류 | 잘못되었거나 없는 리소스는 두 엔드포인트 모두 `invalid_target`(RFC 8707)으로 답합니다. 다만 다른 리소스에 바인딩된 코드는 `invalid_grant`로 답합니다 | `invalid_request` | `agent-authorize.ts`, `agent-oauth-routes.ts` | 해당 모듈 |
| 브라우저 바인딩 | 브라우저마다 무작위 논스 하나를 `/connect`의 HttpOnly 쿠키에 24시간 두고, 그 브라우저가 여는 모든 트랜잭션이 재사용합니다. 트랜잭션에는 그 해시를 저장합니다 | 트랜잭션별 쿠키 | `agent-authorize.ts` | 같은 파일의 `BINDING_COOKIE`와 `bindingCookie` |
| 로그인 복귀 쿠키 | `fmat_auth_return`을 `/auth`에 10분간 두며, 살아 있는 호스트 트랜잭션일 때만 설정하고 모든 콜백에서 지웁니다 | Supabase 리디렉션 URL로 트랜잭션 전달 | `google-sign-in.ts` | 같은 파일의 `RETURN_COOKIE` |
| 교차 출처 프로토콜 호출 | 디스커버리, 등록, 토큰, 철회는 쿠키를 읽지 않고 브라우저 기반 클라이언트가 호출하므로 `Access-Control-Allow-Origin: *`로 답합니다 | CORS 없음 | `agent-oauth-routes.ts` | 같은 파일의 `CORS` |
| 메타데이터 캐시 | 클라이언트 메타데이터 문서는 `max-age`만큼 캐시하며 최소 5분, 최대 24시간입니다. 클라이언트 ID당 시간당 최대 30번 가져옵니다 | 캐시 없음 | `agent-clients.ts` | 같은 파일의 `METADATA_LIMITS`와 `lib/server/agent-limits.ts`의 `AGENT_LIMITS` |
| 프로토콜 한도 | 등록은 출처당 시간당 10회, 하루 500회; 인가는 출처당 시간당 30회; 토큰은 클라이언트당 분당 60회; 도구 호출은 허가당 분당 120회 | 무제한 | 설계 12 | `lib/server/agent-limits.ts`의 `AGENT_LIMITS` |
| 동의 폼과 콘텐츠 보안 정책 | `/connect/consent`만 `form-action 'self' https: http:`를 허용합니다. Chrome이 `form-action`을 결정 뒤 에이전트 콜백으로 가는 리디렉션에도 적용하기 때문이며, 콜백 자체는 서버에서 검사합니다 | 콜백으로 가는 링크가 있는 페이지로 결정에 답하기 | `apps/web/next.config.ts` | 같은 파일의 `consentContentSecurityPolicy` |
| 동의 페이지 리퍼러 | `same-origin`입니다. `no-referrer`이면 Chrome이 폼 전송에 `Origin: null`을 보내 동일 출처 검사가 거부하기 때문입니다 | `no-referrer` | `apps/web/app/connect/consent/page.tsx` | 그 파일의 `metadata` |
| 스크립트 없는 동의 폼 | 허용과 거부는 `/connect/decision`으로 전송하는 일반 HTML 폼이므로 JavaScript 없이도 동의할 수 있습니다 | JSON 라우트를 호출하는 클라이언트 컴포넌트 | `apps/web/app/connect/consent/page.tsx` | 그 페이지와 `createDecisionHandler` |
| 정지된 호스트와 허가 | 정지된 호스트도 메뉴에서 자신의 에이전트를 조회하고 철회할 수 있습니다. 페이지 목록이 허가 철회를 계속 제공하기 때문이며, 그 에이전트의 호출은 이미 실패합니다 | 정지된 동안 연결된 에이전트 숨기기 | `agent-grant-routes.ts` | 같은 파일의 `hostAccountOf` |
| 도구 이름 | 제품 접두사 없는 평범한 동사(`list_requests`, `get_request`)입니다. 클라이언트가 이미 서버별로 도구를 구분하기 때문입니다 | `fmat_` 접두사 | `agent-host-tools.ts` | 도구 목록 |
| 명령 인자 | 카드 명령을 실행하는 도구는 `requestId`, `retryKey`, 선택 사항인 `expectedRevision`, 그리고 `input` 아래에 명령 자체의 인자를 받으며 `input`의 스키마는 그 명령의 스키마입니다 | 모든 명령의 필드를 도구에 평탄화 | `agent-host-tools.ts` | 같은 파일의 `requestCommandTool` |
| 실패 처리 | 명령 실패, 잘못된 인자, 닫힌 요청, 허가가 쓸 수 없는 도구는 `isError`와 `nextAction`이 있는 도구 결과입니다. 알 수 없는 도구와 잘못된 형식의 요청만 프로토콜 오류이며, 토큰에 없는 범위는 `insufficient_scope`와 함께 403으로 답합니다 | 모든 경우를 프로토콜 오류로 처리 | `agent-mcp.ts` | 같은 파일의 `callTool` |
| 지원하지 않는 핸드셰이크 버전 | 알 수 없는 버전의 `initialize`에는 `2025-11-25`로 답하고, 이후 호출에서 알 수 없는 `MCP-Protocol-Version`이 오면 지원 목록과 함께 `400`으로 답합니다 | 핸드셰이크 거부 | `agent-mcp.ts` | 같은 파일의 `createMcpHandler` |
| 서버 이름과 버전 | `find-me-a-time` 1.0.0, 제목은 "Find Me a Time"입니다 | 패키지 버전 | `agent-mcp.ts` | 같은 파일의 `SERVER_INFO` |
| CLI 프로토콜 | CLI는 자체 엔드포인트와만 통신하므로 MCP `2026-07-28`만 사용합니다 | 서버처럼 두 세대 모두 지원 | `cli/src/mcp.ts` | 같은 파일의 `PROTOCOL_VERSION` |
| CLI 도구 탐색 | `fmat call`은 먼저 `tools/list`를 읽으므로, 알 수 없거나 허가되지 않은 도구는 호출 전에 사용법 오류가 되며, 재시도 키는 스키마가 받는 도구에만 붙입니다 | 무조건 호출 | `cli/src/app.ts` | 같은 파일의 `main` |
| CLI 키체인 쓰기 | 자격 증명은 `security -i`의 표준 입력으로 16진수 인코딩해 macOS 키체인에 저장하므로 프로세스 목록에 나타나지 않습니다 | 값을 argv에 넣는 `security add-generic-password -w` | `cli/src/store.ts` | 같은 파일의 `writeSaved` |
| CLI 갱신 | 만료 30초 이내의 토큰은 먼저 갱신하며, 갱신이 거부되거나 응답이 없으면 저장된 연결을 지우고 종료 코드 3으로 끝냅니다 | 갱신 재시도. 이미 쓴 토큰을 다시 보내 허가를 철회시키게 됩니다 | `cli/src/app.ts`, `cli/src/oauth.ts` | 해당 파일의 `fresh`와 `refresh` |
| CLI 출처 | `https` 출처, 또는 로컬 실행용으로 `localhost`, `127.0.0.1`, `[::1]`의 `http` | 모든 출처 | `cli/src/app.ts` | 같은 파일의 `originOf` |
| CLI 빌드 | `npm run build:cli`는 `tsgo`로 `cli/src`를 `cli/dist`로 컴파일하고, `npm run fmat -- <command>`는 체크아웃에서 `tsx`로 실행합니다 | 번들러 | `package.json`, `cli/package.json` | 해당 파일 |
| 생성 재시도 식별 | 요청을 만든 재시도 키로 `create_request`를 부르면 다른 인자와 무관하게 그 요청을 돌려주고, 다른 키는 이미 만들어졌다며 거절합니다. 더 이상 목록에 나오지 않더라도 바인딩된 부트스트랩 허가로 호출할 수 있습니다 | 명령 파이프라인처럼 생성 입력을 해시 | `agent-requests.ts`, `agent-mcp.ts` | 해당 파일의 `createRequestForGrant`와 `callable` |
| 생성 트랜잭션 | 생성은 `runCommand`를 거치지 않고 허가의 행 잠금 아래 자체 트랜잭션에서 실행됩니다. 행위자(바인딩된 요청)가 그 트랜잭션에서 만들어지기 전에는 존재하지 않기 때문이며, `insertDraftRequest`, `identifyDraft`와 세부 정보 명령을 재사용합니다 | 바인딩되지 않은 허가를 위한 새 행위자 종류 | `agent-requests.ts` | 해당 모듈 |
| 생성 시 세부 정보 | 에이전트가 준 세부 정보는 같은 트랜잭션에서 세부 정보 카드의 검증으로 적용되며, 거절되면 아무것도 만들지 않습니다 | 먼저 만들고 세부 정보를 따로 적용 | `agent-requests.ts` | 같은 파일의 `createRequestForGrant` |
| 요청자 투영 | 스레드, 대화 상태, 캘린더 연결, 링크를 뺀 예약 페이지의 뷰이며, 호스트 표시 이름은 따옴표로 묶은 데이터로 인코딩합니다 | eve 요청자 도구의 최소화된 뷰 | `agent-requester-tools.ts` | 같은 파일의 `agentRequesterProjection` |
| 시간 찾기 | `find_times`는 평가를 최대 15초 기다린 뒤 보류 상태로 돌려주며, 끝나면 `get_request`가 보여 줍니다 | eve 도구의 20초 | `agent-requester-tools.ts` | 같은 파일의 `FIND_TIMES_WAIT_MS` |
| 요청자 에이전트 목록 | 예약 페이지의 스레드 메뉴에 `/app`과 같은 대화상자인 **Connected agents**가 추가되며, 철회는 `agent.revoke_grant`를 거칩니다 | 별도 페이지 | `guest-workspace.tsx` | 같은 파일의 `ThreadMenu` |
| 진입 문서 | 지침 버전 3은 각 역할의 MCP 엔드포인트와 권한, 동의 단계, 요청자의 번호 매긴 단계, 게시되지 않은 CLI를 명시하고 웹 이어가기를 유지하며, HTML 에이전트 섹션은 같은 내용을 한 문장으로 말합니다 | 클라이언트가 통과할 때까지 버전 2의 "아직 사용할 수 없음" 유지 | `entry-documents.ts`, `apps/web/app/page.tsx`, `apps/web/app/[handle]/page.tsx` | `hostEntryDocument`와 `requesterEntryDocument` |
| 클라이언트별 메모 | 새 기술 문서 `09_agent_clients.md`는 각 클라이언트가 시도할 연결 경로와 역할별 결과를 담으며, 기록되기 전까지는 "아직 실행되지 않음"입니다 | 인수 기록의 행만 사용 | `09_agent_clients.md` | 해당 문서 |

### 운영 결정

| 결정 | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| 로컬 합류 | 합류는 한 요청에서 요청자에는 스크립트된 MCP 클라이언트를, 호스트에는 CLI를 써서 호스트의 직접 승인과 Google 대역을 상대로 한 예약 작업까지 로컬에서 실행했으며, 명명된 클라이언트는 실행되지 않았습니다 | 합류 증거 전에 명명된 클라이언트를 기다림 | `tests/integration/agent-join.test.ts`; [인수 기록](07_acceptance_record.md#phase-5--agent-access) | 명명된 클라이언트별 실행을 [개인 에이전트 클라이언트](09_agent_clients.md)에 기록 |
| 공유 로컬 스택 | 모든 워크트리가 하나의 로컬 Supabase 스택을 공유하므로, 이 브랜치의 `supabase db reset --local`이 다른 브랜치들이 다시 리셋하기 전까지 그 테이블을 대체했습니다; 병렬 7단계 세션을 위해 적어 둠 | 워크트리마다 별도 스택 | 세션 노트 | 로컬에서 `supabase/config.toml`의 `project_id`를 워크트리마다 따로 지정 |
| 브라우저 테스트 대기 | agent-connect 여정은 에이전트의 리디렉션과 Connected agents 목록을 최대 20초 기다립니다. `next dev`가 그 라우트를 처음 쓸 때 컴파일하고 공유 기기의 부하 평균이 68 가까이였기 때문입니다 | 기본 5초 | `tests/e2e/agent-connect.test.ts` | 해당 기대식 |

### 사용자 대기 항목

다음 단계는 되돌려도 취소할 수 없거나, 제공자 콘솔이나 개인 계정이 필요하거나, 무언가를 게시하기 때문에 수행하지 않았습니다.

- **공유 프로젝트 마이그레이션:** `20261022132708_agent_access.sql`은 `anelszynxtvxoxqvzgqt`에 없습니다. 이는 4단계의 `20261022021159_host_review_and_booking.sql` 다음이며, 그것도 아직 그곳에 대기 중입니다. 둘 다 드라이런을 보여 준 뒤, 사용자의 승인을 받아 배포 워크플로나 `supabase db push --linked`로 적용해야 합니다.
- **서명 키:** Production용 `AGENT_TOKEN_SIGNING_KEY`와 Preview용 하나를 따로 생성해 Vercel 프로젝트 `findmeatime-release`에 설정합니다. 그때까지 토큰 엔드포인트는 구성 사용 불가를 보고합니다.
- **프로덕션 배포:** 병합된 뒤 이 브랜치의 배포, 마이그레이션 다음에.
- **CLI 게시:** `@findmeatime/cli`를 npm에 게시하며, 패키지 스코프도 필요합니다.
- **명명된 클라이언트 실행:** Dots, Muse, Instinct, ChatGPT, Codex, Claude, Claude Code를 각각 두 역할로, 프로덕션에서 팀원 본인의 계정으로 실행하고 [개인 에이전트 클라이언트](09_agent_clients.md)와 인수 기록(AC-14, AC-15, AC-19 ~ AC-25)에 기록합니다. 해결되지 않은 클라이언트는 릴리스 차단 요인입니다.
- **병합:** 풀 리퀘스트에는 팀원의 승인이 필요하며, 관리자 우회는 사용하지 않았습니다.
- **팀원 검토:** D1–D16과 구현 결정에 대한 검토, 이어서 변경의 `openspec archive`.

## 6단계 — `host-imessage-channel`

아직 결정이 없습니다.

## 7단계 — `requester-email-channel`

아직 결정이 없습니다.

## 8단계 — `operations-and-release`

아직 결정이 없습니다.
