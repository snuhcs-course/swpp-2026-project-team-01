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

아직 결정이 없습니다.

## 6단계 — `host-imessage-channel`

아직 결정이 없습니다.

## 7단계 — `requester-email-channel`

[제안서](../../openspec/changes/requester-email-channel/proposal.md#decisions)가 D1–D11을 기록합니다. 계획은 D1–D4를 이 단계에 배정했고 설계에서 D5–D11이 추가되었습니다. 구현을 맡은 세션이 사용자의 지시(모든 결정을 기록하고 바꿀 수 있게 유지)에 따라 2026-10-22에 이를 정했으며, 아직 팀원 검토를 받은 결정은 없습니다.

### 제품 결정

| # | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| D1 | 사용자 지정 eve 채널 `agent/channels/agentmail.ts`는 서명된 수신기만 호스팅합니다. 애플리케이션 작업이 검증된 텍스트를 요청의 기존 요청자 논의에 수락된 입력으로 전달하므로, 이메일과 웹이 하나의 세션을 공유합니다 | Chat SDK 브리지(Gmail 어댑터는 있으나 AgentMail 어댑터는 없음); 스레드마다 채널이 소유하는 eve 세션 | 제안서; 설계 1; 에이전트 구성 | 제안서와 설계 1, 그다음 채널과 `lib/server/email-receipts.ts` |
| D2 | 모든 호스트와 요청에 제품 받은편지함 `findmeatime@agentmail.to` 하나를 씁니다. 새 스레드는 제목의 `@handle`로 호스트를 지정하며, 공개 호스트 페이지가 미리 채워진 `mailto:` 링크를 제공합니다 | 호스트별 받은편지함(최대 세 개, 호스트마다 되돌릴 수 없음); 요청별 받은편지함; 플러스 주소 지정(문서화되지 않음) | 제안서; 설계 2; 제공자 설정 | `AGENTMAIL_INBOX_ID`와 `lib/server/email-receipts.ts`의 핸들 파싱 |
| D3 | 연결 코드는 확인된 연락처가 만료 전에 인증된 발신자 증거와 함께 보낸 새 스레드의 첫 메시지일 때만 바인딩되며, 그 밖의 도착은 조용히 코드를 무효로 만듭니다. 바인딩된 스레드는 바인딩된 주소의 메시지만 전달합니다. 예약 링크와 코드는 모델에 전달되기 전에 가려집니다 | 보낸 사람 주소만으로 바인딩 | 제안서; 설계 5; `requester-email-threads` 델타 | 제안서, 그다음 `lib/server/email-receipts.ts`와 `lib/server/redaction.ts` |
| D4 | 수신 기록은 위치 정보와 페이로드 해시만 남겨 30일간 보관합니다. 바인딩은 요청이 닫히면 중단되고 요청 생성 30일 뒤에 삭제되며, 최종 회신에는 텍스트나 비밀이 없습니다. 제공자 쪽 스레드는 8단계까지 AgentMail에 남습니다 | 수신 기록을 무기한 보관; 제공자 스레드를 지금 삭제 | 제안서; 설계 9; `requester-email-threads` 델타 | 스키마의 `app.cleanup_email_records`와 새 마이그레이션 |
| D5 | 메시지는 `unauthenticated`나 `spam` 라벨이 없는 `message.received`이면서, `authentication_results`가 `dmarc: pass`이거나 `dkim: pass`이고 `dkim_domain`이 From 도메인과 같을 때만 인정됩니다 | From 헤더를 신뢰; AgentMail의 라벨만 사용 | 제안서; 설계 5; `requester-email-threads` 델타 | `lib/server/agentmail.ts`의 `senderAuthenticated` |
| D6 | 준비된 호스트를 지정한 인증된 새 스레드는 식별된 요청을 만듭니다. 보낸 사람의 이름과 주소는 확인되지 않은 연락처로, 시간대는 호스트의 시간대로, 텍스트에 한글이 있으면 한국어로 설정하고, 이어서 3단계의 생성 이메일이 나갑니다. 생성 횟수 제한은 키가 있는 발신자 해시별로 집계합니다 | 신원을 기다리는 초안, 이메일로는 신원을 받을 수 없음 | 제안서; 설계 3; `meeting-requests` 델타 | `lib/server/email-receipts.ts`의 `startByEmail` |
| D7 | **이메일로 계속(Continue by email)**에는 확인된 연락처가 필요합니다. 코드는 `FMAT-`에 크록포드 base32 문자 열 개를 붙인 형태로 30분간 유효하며, 해시 후 봉인되고 요청당 시간당 최대 5개입니다. 바인딩은 이전 스레드를 대체하며, 연결 메시지는 모델에 전달되지 않습니다 | 확인된 연락처 없는 코드; 더 긴 유효 기간 | 제안서; 설계 4; `meeting-requests` 델타 | `lib/server/email-links.ts`의 `EMAIL_LINK_LIMITS` |
| D8 | 전달된 메시지마다 턴이 끝난 뒤 그 턴의 최종 텍스트를 담은 일반 텍스트 회신 하나를 보냅니다. 먼저 내용을 고정하고 회신 ID와 같은 `Idempotency-Key`로 보내며, 결과가 불확실한 발송은 같은 키로 23시간 동안 재시도한 뒤 불확실로 기록합니다 | 부분 회신을 스트리밍; 멱등성 키 없이 회신 | 제안서; 설계 6; `email-delivery` 델타 | `lib/server/email-replies.ts`의 `REPLY_RETRY_HOURS` |
| D9 | **이메일 연결 해제(Unlink email)**는 데이터베이스에서만 바인딩을 끝내므로 AgentMail 장애 중에도 동작합니다 | 연결 해제 시 스레드에 알림 | 제안서; 설계 4 | `lib/server/email-links.ts`의 `request.email_link.unlink` |
| D10 | 운영자 CLI는 비밀의 지문과 함께 수신기를 등록하고 받은편지함의 이전 수신기를 비활성화합니다. 웹훅 URL에는 수신기 ID가 들어 있으며, AgentMail에서 웹훅을 만드는 일은 운영자 단계로 남습니다 | 버전 없는 단일 웹훅 URL | 제안서; 설계 1; `requester-email-ingress` 델타 | `lib/server/operator.ts`의 `email-receiver` 명령 |
| D11 | 너무 긴 메시지와 닫힌 요청에는 고정된 회신 하나를 보냅니다. 첨부 파일은 가져오지 않으며, 우리 쪽에서 보낸 메시지는 무시합니다. 허용 한도에 걸리면 수신 기록을 버리지 않고 지연시킵니다 | 메시지 잘라 내기; 한도에서 메일 버리기 | 제안서; 설계 5 | `lib/server/email-receipts.ts` |

### 구현 결정

| 결정 | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| 서명 검증 | `lib/server/svix.ts`에 직접 작성한 Svix 방식(`{id}.{timestamp}.{body}`에 대한 HMAC-SHA256, 나열된 `v1` 서명 중 하나라도 일치하면 통과, 5분 허용 구간) | `svix` 패키지, 함수 하나를 위한 새 의존성 | 설계 1 | `lib/server/svix.ts`의 `verifySvixSignature` |
| 수신기가 실행되는 곳 | 사용자 지정 채널의 라우트로서 에이전트 서비스에서 실행합니다. `vercel.ts`가 `^/agentmail/(.*)$`를 웹 전체 포괄 라우트보다 먼저 생성된 `eve` 서비스로 보냅니다 | Next.js 웹 서비스의 라우트 | 설계 1 | `vercel.ts`와 `agent/channels/agentmail.ts` |
| 거부 코드 | 알 수 없거나, 비활성화되었거나, 교체되었거나, 키가 바뀐 수신기, 설정되지 않은 배포, 다른 받은편지함의 메시지는 `404`; 잘못되었거나 오래된 서명은 `401`; 너무 큰 본문(256 KiB)은 `413`; 내용이 바뀐 재시도는 `409`; 그 밖의 이벤트 유형은 `204`로 응답합니다 | 비활성화된 수신기와 알 수 없는 수신기를 구분하기 | `lib/server/agentmail-receiver.ts` | 같은 파일의 `receiveAgentMailWebhook` |
| 수신 기록 식별 | 제공자의 `event_id`를 쓰고, 전달 ID와 메시지 ID도 각각 고유해야 합니다. 중복은 이벤트, 받은편지함, 스레드, 메시지, 페이로드 해시가 모두 일치해야 하므로, 두 번째 구독이 같은 이벤트를 전달해도 여전히 중복입니다 | 구독마다 달라지는 Svix ID를 키로 쓰기 | `email_receipts` 스키마 | `lib/server/agentmail-receiver.ts`의 `storeReceipt` |
| 수신 기록 작업 시도 | 10회. 허용 구간이나 AgentMail 장애로 메시지가 최대 약 세 시간의 백오프만큼 지연된 뒤, 작업은 소진된 채 눈에 보이는 상태로 남습니다 | 기본값 5회 | `lib/server/agentmail-receiver.ts` | `EMAIL_RECEIPT_ATTEMPTS` |
| 수신기 감사 | 수신기 행 자체에 각 수신기를 누가 어느 환경에서 등록하고 비활성화했는지 기록합니다. 등록은 받은편지함별 권고 잠금을 잡습니다 | 별도의 감사 테이블 | `email_receivers` 스키마; `app.operator_register_email_receiver` | 스키마와 새 마이그레이션 |
| 전달 경로 | 수신 기록 작업은 수신 기록 ID를 클라이언트 입력 ID로 삼아 `acceptGuestMessage`를 거쳐 전달하므로, 웹과 똑같이 가림 처리, 허용, 세션 색인, 모델 한도가 적용되고 재시도된 작업은 같은 입력을 찾습니다 | 별도의 이메일 입력 경로 | `lib/server/email-receipts.ts` | 같은 파일의 `forward` |
| 바인딩 먼저, 생성 먼저 | 이메일로 시작하면 메시지를 전달하기 전에 스레드별 권고 잠금 아래의 커밋된 트랜잭션 하나에서 생성, 식별, 바인딩을 마칩니다. 재시도는 `bound_by_receipt_id`로 자신의 바인딩을 알아봅니다 | 작업의 트랜잭션 안에서 요청 생성하기. 대화 경로의 자체 연결에서는 보이지 않습니다 | `email_threads` 스키마 | `lib/server/email-receipts.ts`의 `start` |
| 이메일 요청 기본값 | 호스트의 시간대(설정되지 않았으면 UTC), 제목이나 본문에 한글이 있으면 한국어이고 없으면 영어입니다. 이름은 From 표시 이름이며 없으면 주소의 로컬 파트입니다 | 먼저 이메일로 시간대를 묻기 | 설계 3 | `lib/server/email-receipts.ts`의 `start`와 `messageLanguage` |
| 첫 메시지 텍스트 | 추출한 새 텍스트 앞에 `Subject: …`와 빈 줄을 붙여, 제목의 의미가 어시스턴트에게 닿게 합니다 | 제목 버리기 | `lib/server/email-receipts.ts` | 같은 파일의 `forward` |
| 턴 회신 시점 | 회신 작업은 전달 30초 뒤가 기한이며 턴이 실행되는 동안 재시도합니다. 턴이 끝나면 세션 소유자 훅이 앞당기고, 분당 스윕이 보냅니다. 12회 시도 뒤 대기 중인 회신은 억제됩니다 | 훅에서 직접 보내는 회신. 훅은 에이전트 서비스에서 실행되어 턴을 실패시킬 수 없습니다 | 설계 6 | `lib/server/email-replies.ts`의 `TURN_REPLY_DELAY_SECONDS`와 `REPLY_ATTEMPTS`; `agent/hooks/session-owner.ts` |
| 회신 텍스트 | 도구 호출로 끝나지 않는 턴의 `message.completed` 텍스트를 이어 붙인 뒤, 이메일로 보낸 예약 링크를 안내하는 두 줄짜리 바닥글을 붙입니다. 최대 20,000자입니다 | 중간 메시지를 모두 스트리밍하기 | 설계 6 | `lib/server/email-replies.ts`의 `turnReplyText`와 `withFooter` |
| 회신 응답 처리 | 메시지 ID가 있는 `200`은 수락, `409`(다른 텍스트에 키 재사용)는 즉시 불확실로 기록, `429`, `5xx`, 시간 초과, 유실된 응답은 같은 키로 재시도, 그 밖의 `4xx`는 거부됩니다 | `429`를 거부로 처리하기 | `lib/server/agentmail.ts` | 같은 파일의 `classifyReplyResponse` |
| 관문 위치 | 두 이메일 작업 모두 수신 기록이나 회신을 읽기 전에, 그리고 작업자의 클레임과 모든 전송 호출에서도 메시지 허용 여부를 확인합니다 | 전송에서만 확인하기 | `lib/server/email-receipts.ts`, `lib/server/email-replies.ts` | 핸들러 |
| 텍스트의 링크 코드 | 가림 처리는 호스트와 요청자를 가리지 않고 모든 대화 입력에서 `FMAT-` 코드를 제거합니다 | 이메일에서만 가리기 | `lib/server/redaction.ts` | 같은 파일의 `LINK_CODE` |
| 지침 | 요청자 지침 한 줄: 이메일 회신에는 카드가 보이지 않으므로, 어시스턴트는 카드를 이름으로 부르고 예약 페이지에 있다고 알리며 링크는 절대 쓰지 않습니다 | 별도의 이메일 대상 | `agent/instructions/requester.ts` | 해당 조각 |
| 연결 명령 | `request.email_link.create`와 `request.email_link.unlink`는 예약 페이지의 기존 명령 경로에서 실행되고, `GET /api/requests/{bookingId}/email-link`는 상태만 제공합니다. 저장된 명령 결과에는 링크 ID가 들어가며 코드는 절대 들어가지 않습니다 | 동작마다 별도의 POST 경로 | 설계 4 | `lib/server/requester-routes.ts`의 `requesterCommands`와 `createEmailLinkStatusHandler` |
| 연결 전 대기 | 다른 스레드가 연결되어 있어도 대기 중인 코드는 표시되며, 그 코드를 보내면 대화가 옮겨 갑니다. 코드의 **취소(Cancel)**는 `pendingOnly`를 넘겨 연결된 스레드를 유지합니다 | 연결된 동안 코드 숨기기 | 설계 4 | `lib/server/email-links.ts`의 `readEmailLinkStatus`와 `unlinkEmailCommand` |
| 확인되지 않은 연락처 | 코드를 만들면 `invalid_input`으로 응답하고, 카드는 먼저 주소를 확인하라고 안내하며 버튼을 보이지 않습니다 | 새 오류 범주 | 설계 4 | `lib/server/email-links.ts`의 `createEmailLinkCommand`, `apps/web/app/_components/requester/cards.tsx`의 `EmailLinkLine` |
| 카드 배치 | **이메일로 계속(Continue by email)**은 상태 줄 아래의 조용한 한 줄이며, 대기 중인 코드는 **이메일 열기(Open email)**, **복사(Copy)**, **이메일 링크 확인(Check email link)**, **취소(Cancel)**가 있는 대화 카드 하나로 열립니다. 명령 응답이 유실되면 같은 재시도 키로 **같은 연결 동작 다시 시도(Retry same linking action)**를 보입니다 | 상시 설정 패널 | 설계 4, DESIGN.md 대화 카드 | `EmailLinkLine` |
| 공개 페이지의 이메일 시작 | `AGENTMAIL_INBOX_ID`가 설정된 경우에만, 제목이 `Meeting with @{handle}`인 `mailto:`와 함께 "Prefer email? Write to {inbox}"를 보입니다 | 항상 보이기 | 설계 2 | `apps/web/app/[handle]/page.tsx` |
| 연결 확인 문구 | 요청의 언어로 "This thread is now linked to your request with {host}. Reply here to continue." | 코드 되풀이하기 | `lib/server/email-links.ts` | 같은 파일의 `CONFIRMATION` |
| 스레드 알림 복사본 | `enqueueStatusNotice`는 알림과 바인딩마다 스레드 회신 하나를 기록하며, 이메일의 템플릿과 매개변수로 만들어 바인딩의 최신 메시지에 회신하고 예약 링크는 발송 때까지 봉인해 둡니다. 확인 이메일은 Cloudflare로만 보냅니다 | 확인도 스레드로 보내기 | 설계 7 | `lib/server/booking-notices.ts`의 `enqueueStatusNotice` |
| 알림 유효성 | 스레드 알림도 이메일과 같은 규칙(`noticeStillCurrent`)으로 발송 때 확인하고, 바인딩이 더 이상 활성이 아니면 보내지 않습니다 | 바인딩만 확인하기 | 설계 7 | `lib/server/email-delivery.ts`의 `noticeStillCurrent`, `createEmailReplyHandler` |

### 사용자 대기 항목

다음 단계는 되돌려도 취소할 수 없거나, 제공자 콘솔이 필요하거나, 팀 밖의 사람에게 발송되기 때문에 수행하지 않았습니다.

- **AgentMail 받은편지함:** `findmeatime@agentmail.to`는 만들지 않았습니다. 계정이 받은편지함 세 개 한도에 도달했고, 받은편지함을 비우거나 만드는 일은 되돌릴 수 없습니다.
- **AgentMail 웹훅:** AgentMail에 등록한 웹훅이 없고, 공유 프로젝트에 등록한 수신기도 없습니다.
- **공유 프로젝트 마이그레이션과 프로덕션 배포:** 이 브랜치의 것.
- **실제 다중 턴 받은편지함 전달:** 팀이 통제하는 주소로 하는 증거(7단계 증거)이며, 받은편지함, 웹훅, 배포가 필요합니다.
- **팀원 검토:** D1–D11에 대한 검토, 이어서 변경의 `openspec archive`.

## 8단계 — `operations-and-release`

아직 결정이 없습니다.
