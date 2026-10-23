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
| 검토 우회 | PR #30은 2026-10-22에 사용자의 요청으로 CI가 통과한(7개 중 7개) 뒤 팀원 승인 없이 `--admin`으로 squash 병합했습니다 | 승인을 기다림 | squash 커밋 메시지 | 팀원이 나중에 [제안서](../../openspec/changes/host-review-and-booking/proposal.md#decisions)와 이 기록을 기준으로 검토 |
| 마이그레이션 경로 | `20261022021159_host_review_and_booking.sql`을 2026-10-22에 `anelszynxtvxoxqvzgqt`에 `supabase db push --linked`로 푸시했으며, 이것만 나열한 드라이 런 뒤 사용자의 요청으로 이를 필요로 하는 배포보다 먼저 실행했습니다. 이제 마이그레이션 22개가 적용되어 있습니다 | 시크릿이 아직 설정되지 않은 `Deploy shared Supabase` 워크플로 | [인수 기록](07_acceptance_record.md#phase-4--host-review-and-booking) | 이후 마이그레이션이 CI를 거치도록 워크플로의 저장소 시크릿을 설정 |
| 프로덕션 배포 | `708381cb`의 `origin/main` 깨끗한 체크아웃에서 `findmeatime-release`에 연결해 `npm ci`(`vercel.ts` 컴파일에는 `eve` 설치가 필요함) 뒤 `vercel deploy --prod` | Git 연동 배포(구성되지 않음) | 인수 기록 | 3단계와 같음 |
| 프로덕션 인수 확인 | 사용자가 로그인하고 주소를 알려 준 뒤, 사용자 본인의 호스트 계정과 게스트로서의 팀원 두 번째 주소를 사용해 내장 브라우저에서 실행했습니다 | 별도의 테스트 호스트 계정 | [인수 기록](07_acceptance_record.md#production-acceptance-check) | 전용 테스트 호스트가 생기면 그것을 사용 |

### 사용자 대기 항목

다음 단계는 되돌려도 취소할 수 없거나, 제공자 콘솔이 필요하거나, 팀 밖의 사람에게 발송되기 때문에 수행하지 않았습니다.

- **게스트 받은편지함:** `dodo4114@snu.ac.kr`에 도착한 게스트의 확인 사본과 Google의 초대는 세션이 읽을 수 없습니다; 호스트의 사본, 이벤트, Gmail의 `text/calendar` 첨부 파일은 2026-10-22에 확인했습니다([인수 기록](07_acceptance_record.md#production-acceptance-check)).
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

- **공유 프로젝트 마이그레이션:** `20261022132708_agent_access.sql`은 `anelszynxtvxoxqvzgqt`에 없습니다. 4단계를 포함한 이전 22개 마이그레이션은 그곳에 적용되어 있으므로(4단계 운영 결정), 대기 중인 것은 이것 하나뿐입니다. 드라이런을 보여 준 뒤, 그것이 필요한 배포보다 먼저 사용자의 승인을 받아 배포 워크플로나 `supabase db push --linked`로 적용해야 합니다.
- **서명 키:** Production용 `AGENT_TOKEN_SIGNING_KEY`와 Preview용 하나를 따로 생성해 Vercel 프로젝트 `findmeatime-release`에 설정합니다. 그때까지 토큰 엔드포인트는 구성 사용 불가를 보고합니다.
- **프로덕션 배포:** 병합된 뒤 이 브랜치의 배포, 마이그레이션 다음에.
- **CLI 게시:** `@findmeatime/cli`를 npm에 게시하며, 패키지 스코프도 필요합니다.
- **명명된 클라이언트 실행:** Dots, Muse, Instinct, ChatGPT, Codex, Claude, Claude Code를 각각 두 역할로, 프로덕션에서 팀원 본인의 계정으로 실행하고 [개인 에이전트 클라이언트](09_agent_clients.md)와 인수 기록(AC-14, AC-15, AC-19 ~ AC-25)에 기록합니다. 해결되지 않은 클라이언트는 릴리스 차단 요인입니다.
- **병합:** 풀 리퀘스트에는 팀원의 승인이 필요하며, 관리자 우회는 사용하지 않았습니다.
- **팀원 검토:** D1–D16과 구현 결정에 대한 검토, 이어서 변경의 `openspec archive`.

## 6단계 — `host-imessage-channel`

[제안서](../../openspec/changes/host-imessage-channel/proposal.md#decisions)가 D1–D14를 기록합니다. 계획은 어댑터와 발신자 형식, 회선 프로비저닝과 신규 대화 허용량, 코드 만료와 재전송 한도, 딥링크 형식을 이 단계에 배정했습니다. 사용자가 2026-10-23에 D3과 D4를 정했고, 나머지는 구현을 맡은 세션이 사용자의 지시(모든 결정을 기록하고 바꿀 수 있게 유지)에 따라 2026-10-23에 정했으며, 아직 팀원 검토를 받은 결정은 없습니다.

**팀원의 초안 PR #23은 채택하지 않았습니다.** PR #23(enu3379, `docs/host-imessage-linking`)은 호스트가 `/app`에서 번호를 입력하면 Thyme이 먼저 문자를 보내고, 두 자리 숫자 답장이 일치하면 번호를 연결합니다. 그러면 Thyme의 첫 메시지가 요청하지 않은 것이 되어 수신자에게는 스팸 배너로 보이고 회선의 일일 신규 대화 한도를 하나 소모하는데, PRD의 수신 우선 연결 코드는 바로 이를 피하기 위한 것이며 사용자는 2026-10-23에 PRD의 설계를 유지하기로 했습니다. 세 부분은 재사용하며 풀 리퀘스트에서 출처를 밝힙니다: Photon 웹훅 서명 검증(원본 본문에 대한 `v0:` HMAC, 5분 허용 구간, 웹훅 ID 확인), `2xx` 이전에 저장하고 처리 뒤 텍스트를 지우는 내구성 있는 수신 이벤트, 간격을 둔 발송 한도. 이 PR의 마이그레이션 타임스탬프는 이미 공유 프로젝트에 적용된 마이그레이션보다 앞서므로 스키마 파일은 하나도 복사하지 않았습니다. PR 자체는 건드리지 않았습니다.

### 제품 결정

| # | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| D1 | 애플리케이션이 소유하는 어댑터: `agent/channels/photon.ts`는 `200` 이전에 수신 기록과 작업을 저장하는 서명된 수신기만 호스팅하고, 애플리케이션이 발신자를 호스트가 선택한 논의로 매핑하며, 발신 텍스트는 하나의 전송 모듈(프로덕션은 Spectrum SDK, 그 밖에는 루프백 대역)과 발신함을 거칩니다 | eve의 네이티브 `photonIMessageChannel`: 아무것도 저장하지 않고 프로세스 내 디스패치 뒤에 확인 응답하며, iMessage 스레드마다 세션 색인 밖의 eve 세션 하나를 두고, 접수 한도 아래에서 메시지를 보류할 수 없고, 발신함이나 불확실 발송 기록이 없음 | 제안서; 설계 1; 에이전트 구성; 제공자 설정 | 제안서와 설계 1, 이어서 `agent/channels/photon.ts`와 `lib/server/photon.ts` |
| D2 | 발신자는 Photon의 `message.sender.id`입니다: E.164(`+15551234567`) 또는 소문자로 바꾼 Apple ID 이메일이며, 키 해시로 저장하고 봉인하고, `space.type = "dm"`만 인정하며, 텍스트나 스페이스 ID에서 파싱하지 않습니다 | 스페이스 ID로 매칭; 채팅 GUID에서 번호 파싱 | 제안서; 설계 1; 제공자 설정 | `lib/server/photon-receiver.ts`의 `normalizeSender` |
| D3 | (사용자, 2026-10-23.) PRD의 범위: 호스트가 보내는 일회용 코드이므로 Thyme의 첫 메시지는 답장이며, 인증된 브라우저에서 마스킹된 발신자의 **확인 및 연결(Confirm and link)**을 거친 뒤에만 바인딩되고, 대체 경로는 **코드를 대신 보내 주세요(Send me a code instead)**이며, 호스트 계정을 만들거나 들어가는 유일한 방법은 계속 Google입니다 | PR #23의 발신 우선 문자 및 답장 확인; 전화번호 계정; iMessage 우선 계정 생성 | PRD 10절; 제안서; 설계 4 | PRD 먼저, 이어서 제안서 |
| D4 | (사용자, 2026-10-23.) **iMessage 연결(Connect iMessage)**은 코드를 받아 곧바로 메시지 앱을 엽니다: iOS와 iPadOS는 `sms:<number>&body=<text>`, Android는 `sms:<number>?body=<text>`이고 텍스트는 퍼센트 인코딩하며, 데스크톱과 그 밖의 브라우저는 번호, 코드, **복사(Copy)**, iOS 딥링크의 QR 코드가 있는 인라인 카드를 받고, 메시지 앱을 여는 것은 연결로 간주되지 않습니다 | 펼친 카드의 두 번째 탭으로서의 **메시지 앱 열기(Open Messages)**(이전 문서); `SMSTO:` QR 페이로드 | PRD 10절; 페이지 목록; 인터페이스; 호스트 온보딩 H11; 프론트엔드 아키텍처; 제공자 설정; 설계 5 | `lib/contracts/imessage.ts`의 `deepLinkFor`와 `messagesPlatform` |
| D5 | 연결 코드는 `FMAT-`에 크록포드 base32 문자 열 개(이미 모든 곳에서 마스킹되는 이메일 계열)를 붙인 형태이며, 메시지는 `Link my Find Me a Time account: FMAT-…`이고, 15분간 유효하며, 해시하고 봉인하며, 호스트당 시간당 최대 5개이고, 도착 뒤 확인까지 15분입니다 | 짧은 숫자 코드(유효 기간 안에 추측 가능); 별도의 마스킹이 필요한 코드 계열 | 제안서; 설계 4 | `lib/server/imessage-links.ts`의 `IMESSAGE_LINK_LIMITS` |
| D6 | 대체 경로: 6자리, 10분간 유효, 시도당 3회 발송에 60초 간격, 호스트당 24시간에 5회 발송, 잘못 입력 5회면 무효, 회선당 24시간에 대체 경로 발송 최대 20회(`PHOTON_FALLBACK_DAILY_LIMIT`) | 회선 전체 한도 없음(Photon은 회선당 일일 신규 대화를 제한하며 수치는 공개되지 않음) | 제안서; 설계 6 | `lib/server/imessage-links.ts`의 `IMESSAGE_FALLBACK_LIMITS`; 환경 변수 |
| D7 | 하나의 Photon 프로젝트에 회선 하나(`PHOTON_LINE_NUMBER`)와 수신기가 ID와 서명 비밀을 확인하는 웹훅 하나(`PHOTON_WEBHOOK_ID`, `PHOTON_WEBHOOK_SECRET`) | AgentMail처럼 지문이 있는 운영자 등록 수신기(웹훅 하나에 비해 움직이는 부분이 많음) | 제안서; 설계 2; 제공자 설정 | `lib/server/photon-receiver.ts`의 `photonReceiverConfig` |
| D8 | 메시지 전체가 명령이며 대소문자를 구분하지 않습니다: `help`, `requests`, `request <ref>`, `setup`, `review`, `changes`, `share <ref>`, `dismiss <ref>`, `approve <ref>`, `decline <ref>`, `confirm <ref>`; 참조는 요청 ID의 크록포드 문자 여섯 개, `<request>-<version>`, `<request>-S<n>`, 설정 제안 해시의 여덟 문자이며, 결정은 재시도 키 `imessage:{receiptId}`로 명령 파이프라인을 통해 실행됩니다 | 자연어 승인; 버튼(iMessage에는 신뢰할 만한 버튼이 없음) | 제안서; 설계 8; 에이전트 구성 | `lib/server/imessage-commands.ts`의 `parseCommand`와 참조 도우미 |
| D9 | 발신 메시지마다 고정되고 봉인된 발신함 행 하나를 `imessage_send`가 보내며, 시작되었지만 응답을 잃은 발송은 `uncertain`이 되어 다시 보내지 않고, 발송 전 거부는 최대 5회 재시도하며, 호스트 전용 행은 연결 해제 뒤 억제됩니다 | 불확실 발송 재시도(Photon은 확인 가능한 멱등성 키를 주지 않으므로 호스트가 중복을 받을 수 있음) | 제안서; 설계 3 | `lib/server/imessage-outbox.ts` |
| D10 | 연동되지 않은 직접 발신자에게는 24시간에 한 번 `/app`을 안내하는 고정 회신 하나를 보내고, 그룹 대화, 에코, 리액션에는 아무것도 보내지 않습니다 | 침묵(iMessage 우선 소개에는 안내가 없음); 모든 메시지에 회신 | 제안서; 설계 7 | `lib/server/imessage-receipts.ts`의 `UNLINKED_REPLY_HOURS` |
| D11 | 전달된 텍스트는 공유 논의에 `[iMessage] …`로 저장하고, 호스트 지시 조각이 iMessage에는 카드가 없음을 알리고 결정에 쓸 명령을 명시합니다 | 별도의 iMessage 논의; 표시 없음 | 제안서; 설계 9; 에이전트 구성 | `lib/server/imessage-receipts.ts`의 `IMESSAGE_PREFIX`; `agent/instructions/host-imessage.ts` |
| D12 | 새 요청, 승인 대기 중인 제안(정확한 명령 포함), 확정된 예약, 확정되지 않은 예약, 아직 보류 중인 예약에 대한 호스트 요약을 이벤트당 `imessage_notice` 작업 하나로 도메인 트랜잭션에 기록하고, 작업이 이벤트의 레코드로부터 고정합니다 | 모든 상태 변경에 대한 요약. 도메인 트랜잭션에서 아웃박스 행을 봉인하는 방식(모든 명령에 토큰 키가 필요해짐) | 제안서; 설계 10 | `lib/server/imessage-notices.ts`의 `enqueueHostNotice`; `lib/server/imessage-notice-job.ts` |
| D13 | **연락처에 추가(Add to contacts)**는 네이티브 연락처 카드 공유 하나를 큐에 넣고, 상태는 큐에 있음, 수락됨, 실패, 불확실이며 "저장됨"은 절대 아니고, 불확실한 동안에는 재전송하지 않습니다 | 연동 시 카드를 자동으로 공유 | 제안서; 설계 11 | `lib/server/imessage-links.ts`의 `imessage.contact_card.share` |
| D14 | 수신 텍스트는 처리 시 지우고 수신 기록은 30일 뒤 삭제하며, 발신함 텍스트는 최종 상태에서 지우고, 연결 시도와 종료된 바인딩은 종료 30일 뒤 삭제합니다 | 진단용으로 수신 텍스트 보관 | 제안서; 설계 13 | `app.cleanup_imessage_records`와 새 마이그레이션 |

### 구현 결정

| Spectrum SDK 패키지 | `@spectrum-ts/core`와 `@spectrum-ts/imessage` 12.14.0을 정확한 버전으로 고정하고, `lib/server/photon.ts`에서만 동적 import로 불러오며, SDK가 Photon에 OpenTelemetry 데이터를 보내지 않도록 `telemetry: false`로 둡니다; 두 패키지가 `^5 \|\| ^6` peer를 선언하므로 패키지 단위 `overrides` 항목으로 TypeScript 7을 받아들이게 합니다. `npm audit`은 이들의 `@photon-ai/otel` OpenTelemetry 체인에서 중간 등급 권고를 보고하지만, telemetry를 끄면 그 체인은 쓰이지 않습니다 | `spectrum-ts` 메타 패키지(Slack, Telegram, WhatsApp 제공자도 포함); eve에 번들된 사본(export되지 않음); 전체 트리에 `--legacy-peer-deps` | `package.json`; 설계 1 | `lib/server/photon.ts`의 `spectrumTransport`; `overrides` 항목 |
| 불확실한 전송 | 이후 시도에서 `dispatching` 상태로 발견된 행, 또는 응답이 유실되었거나 20초 후 시간 초과된 전송은 즉시 `uncertain`이 되며 다시 보내지 않습니다; `unavailable`(연결 거부, 클라이언트 없음)만 행을 `queued`로 되돌립니다 | 23시간 동안 같은 키로 재전송하는 7단계 방식, 이는 제공자의 멱등성 키가 필요합니다 | 설계 3 | `lib/server/imessage-outbox.ts`의 `createImessageSendHandler` |
| 전송 작업 배치와 시도 횟수 | 워커 배치당 전송 네 건; 메시지는 5회, 턴 답장은 8회(약 40분) 시도하며, 턴 답장의 텍스트는 아무것도 잠그기 전에 세션의 기록된 이벤트에서 읽습니다 | 기본 배치 | `lib/server/job-handlers.ts`; `lib/server/imessage-outbox.ts` | `JOB_BATCH_LIMITS`; `SEND_ATTEMPTS`와 `TURN_REPLY_ATTEMPTS` |
| 결정 | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| 카드 상태 순서 | 진행 중인 연결 시도(대기 중인 코드, 수신한 발신자 또는 대체 코드)가 활성 연결보다 먼저 표시되므로, 시도를 마치면 연결이 새 발신자로 옮겨 갑니다; 상태에는 대체 코드가 담기지 않으며, 발신자는 마지막 네 자리 또는 이메일의 첫 글자와 도메인으로 가려집니다 | 연결된 동안 시도를 숨김 | 설계 4 | `lib/server/imessage-links.ts`의 `readImessageStatus` |
| 잘못된 대체 코드 입력 | 틀린 코드는 오류가 아니라 결과(`wrong`과 남은 시도 횟수)로 응답하므로, 횟수가 명령의 트랜잭션에 저장됩니다; 다섯 번째 입력은 코드의 해시를 지웁니다 | 오류로 거절, 이 경우 횟수가 롤백됨 | 설계 6 | `lib/server/imessage-links.ts`의 `verifyImessageCodeCommand` |
| 다른 곳에 연결된 번호 | 다른 호스트가 이미 연결한 번호로 `send_code`를 보내면 전송처럼 응답하되 아무것도 큐에 넣지 않으므로, 카드로 이 제품에서 누가 iMessage를 쓰는지 알아낼 수 없습니다 | 눈에 보이게 거절 | 설계 6 | `sendImessageCodeCommand` |
| 카드 배치 | iMessage 연결 카드는 설정이 준비되면 공유 링크 다음에 표시되며, 호스트가 연결하거나 **Maybe later**를 누를 때까지(이 브라우저의 저장소에 기억됨) 유지됩니다; 메뉴의 새 **iMessage** 항목은 어느 단계에서든 카드를 열고, 연결된 호스트의 카드는 전송 실패, **Add to contacts**, **Unlink**를 보여 주기 위해 계속 남습니다 | 설정 대화상자; 설정이 준비되기 전에 표시 | 설계 5; 호스트 온보딩 H11 | `apps/web/app/_components/host-workspace.tsx`의 `SetupWorkspace` |
| 메시지 앱 열기 | **Connect iMessage**는 코드를 기다린 뒤 플랫폼의 딥링크로 `window.location.assign`을 호출합니다; 카드는 **Open Messages**를 일반 링크로 유지하며, QR 코드는 클라이언트에서 `uqr` 0.1.2로 렌더링한 SVG입니다. 기다린 요청 뒤에 iOS Safari가 메시지 앱을 여는지는 실제 기기에서만 확인합니다 | 페이지를 불러올 때 코드를 미리 가져와 탭하면 메시지 앱이 동기적으로 열리게 함(탭하지 않을 호스트에게도 코드가 발급됨) | 설계 5 | `apps/web/app/_components/imessage/imessage-card.tsx`의 `connect` |
| 대체 코드 재전송 | 재전송은 번호가 아니라 열려 있는 시도(`{ resend: true }`)를 지정하는데, 카드는 번호를 가려진 형태로만 알기 때문입니다 | 번호를 브라우저로 반환 | 설계 6 | `sendImessageCodeCommand` |
| 결정 리비전 | `approve`, `decline`, `share`, `dismiss`는 참조와 함께 읽은 요청 리비전을 명령의 기대 리비전으로 넘기고, `confirm`은 초안 리비전을 넘기므로, 읽은 뒤 결정하기 전에 변경이 생기면 거절됩니다 | 리비전을 넘기지 않음(명령이 이를 거절함) | 설계 8 | `lib/server/imessage-commands.ts`의 `decide`, `changes`, `confirmSettings` |
| 채널 트랜잭션 | 명령과 전달은 바인딩 갱신과 응답을 위해 수신 작업의 트랜잭션 안에서 실행되므로, 응답이 수신의 결과와 함께 커밋됩니다; 결정과 대화 입력은 각자의 연결에서 별도 트랜잭션으로 커밋하며, 재시도 키와 클라이언트 입력 ID 덕분에 반복해도 안전합니다 | 모든 쓰기를 각자의 연결에서 실행(바인딩에 대한 작업의 행 잠금이 선택 갱신을 막음) | 설계 8 | `lib/server/imessage-receipts.ts`의 `ChannelProcessor` |
| 수락 보류 | 수락 예산이 거절한 수신은 결과 `deferred`로 작업을 완료하고, 60초 뒤에 처리될 새 수신 작업을 게시합니다(최대 240회, 이후 수신은 무시됨). 작업 자체의 백오프가 20초에서 시작하는 반면 chat-workspaces 계약은 1분보다 일찍 처리하지 말라고 하기 때문입니다; 같은 대화의 이후 메시지는 그 뒤에서 계속 기다립니다 | 예외를 던져 20초 백오프를 따름 | 설계 7 | `lib/server/imessage-receipts.ts`의 `ADMISSION_RETRY_SECONDS`와 `ADMISSION_DEFERRALS` |
| 선택한 요청이 사라짐 | 더 이상 호스트의 것이 아니거나 초안인 요청을 선택한 상태에서 온 자유 텍스트는 선택을 해제하고, 설정으로 보내며, 안내를 한 번 보냅니다 | 메시지를 거절함 | 설계 9 | `lib/server/imessage-receipts.ts`의 `forward` |
| 턴 응답 길이 | 턴 응답은 가린 뒤 2,000자로 자르고 나머지는 `/app`에서 보도록 안내합니다; 최종 텍스트가 없는 턴이나 실패한 세션은 고정된 대체 문구를 보내고, 30분 안에 끝나지 않은 턴의 응답은 보내지 않습니다 | 긴 응답을 여러 메시지로 나눔 | 설계 9 | `lib/server/imessage-outbox.ts`의 `imessageTurnText`와 `TURN_REPLY_WAIT_MINUTES` |
| 안정적인 설정 제공자 | `/app` 대화는 항상 설정 제공자로 감싸므로(설정이 로드되기 전에는 값이 null), 설정 로딩이 끝나도 그 항목들이 다시 마운트되지 않습니다. 이전에는 이렇게 해서 부하 중에 Connect iMessage 카드가 입력한 번호와 단계를 잃었습니다 | 카드의 상태를 워크스페이스로 끌어올리기 | `apps/web/app/_components/host-workspace.tsx` | `ConversationSetup`과 `SetupProvider` |
| 장애 뒤 턴 응답(검토) | Photon을 쓸 수 없던 턴 응답은 고정된 텍스트와 함께 `queued`로 돌아가고, 다음 시도가 그 텍스트를 보냅니다 | 턴을 다시 읽는 것; 앞선 코드는 `queued` 행에서 이를 건너뛰어 응답이 전혀 전송되지 않았습니다 | 설계 3 | `lib/server/imessage-outbox.ts`의 `createImessageSendHandler` |
| 그룹 대화의 코드(검토) | 연결 코드는 그룹 확인보다 먼저 처리되므로, 그룹에 올린 코드는 그룹에 답장 없이 그 코드가 가리키는 시도를 무효로 합니다 | 그룹 메시지를 먼저 무시하는 것; 유출된 코드가 15분 동안 쓸 수 있는 채로 남았습니다 | 설계 4와 7 | `lib/server/imessage-receipts.ts`의 `processReceipt` |
| 다른 곳에 연결된 번호도 기록(검토) | 다른 호스트가 연결한 번호로의 억제된 전송은 `foreign_binding` 범주의 `suppressed` 발신함 행으로 기록되어 한도에 포함되고 카드에 전송됨으로 표시됩니다 | 행을 쓰지 않는 것; 카드의 상태와 한도가 이를 구별하지 못했습니다 | 설계 6 | `sendImessageCodeCommand`; `recordOutbound`의 `suppressedAs` |
| 재전송된 결정 응답(검토) | 결정 명령은 먼저 재시도 키로 저장된 결과를 찾아 그것으로 응답하므로, 요청이 넘어간 뒤에도 재시도된 수신은 첫 시도와 같게 응답합니다 | 요청을 다시 읽는 것; "바뀐 것 없음"이나 재시도 충돌로 응답했습니다 | 설계 8 | `lib/server/imessage-commands.ts`의 `savedDecisionReply` |
| 순서 대기(검토) | 먼저 온 수신이 아직 처리되지 않은 수신은 결과 `waiting`으로 작업을 끝내고 30초 뒤(최대 600번) 새 작업을 게시하며, 어떤 수신이든 결과가 기록되면 그 대화의 대기 중인 작업이 앞당겨집니다 | 시도를 실패시키는 것; 수신의 시도 횟수를 소진해 긴 연기 뒤로 밀려 버려질 수 있었습니다 | 설계 7 | `lib/server/imessage-receipts.ts`의 `ORDER_RETRY_SECONDS`, `ORDER_WAITS`, `record` |
| 처리 중 연결 해제(검토) | 수신 작업은 처리하는 내내 발신자의 바인딩을 행 잠금하고, 연결 명령의 바인딩 쓰기는 잠금을 최대 5초까지만 기다립니다 | 잠금 없는 읽기; 호스트가 연결을 해제한 뒤에도 결정이 실행될 수 있었습니다 | 설계 7 | `lib/server/imessage-links.ts`의 `lockActiveBindingOfSender` |
| 그 밖의 작은 검토 수정(검토) | 전송 전 Spectrum 실패는 최종 거절이 아니라 `unavailable`입니다; 연락처 카드는 명령의 재시도 키로 식별합니다; 같은 발신자가 코드를 다시 보내면 아무 일도 하지 않습니다; Apple ID 이메일은 처음 두 글자와 마지막 글자로 가립니다; 회선마다 하루 고정 거절은 최대 200개입니다; 정지된 호스트도 연결을 해제할 수 있습니다; 재시도된 전달은 첫 시도가 쓴 토론을 다시 씁니다; 작업 배치당 전송은 두 번입니다; 카드는 연락처 카드가 대기 중일 때 폴링하고 확인 창이 닫히면 새로 고칩니다 | — | 설계 3~9 | 지명된 모듈 |
| 계획의 목록을 넘는 명령 | 계획은 `request`, `review`, `changes`, 승인, 거절, `setup`을 꼽습니다; 이 변경은 `help`, `requests`(참조를 알기 위해), `share`와 `dismiss`(AC-16이 요구하듯 수정된 세부 사항을 텍스트로 공유할 수 있게), `confirm`(온보딩 흐름이 요구하는 설정 확인)을 더합니다 | 변경 공유를 웹에서만 허용 | 설계 8 | `lib/server/imessage-commands.ts`의 `parseCommand` |

### 운영 결정

| 결정 | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| 로컬 스택 | 이 브랜치의 체인으로 초기화한 기본 로컬 Supabase 스택. 다른 단계의 세션이 이 스택을 상대로 실행 중이지 않았기 때문입니다(5단계와 7단계는 병합됨) | 7단계처럼 별도 스택 | 인수 기록 | — (로컬 전용) |
| 따른 참조 | personal-agent 템플릿(`1c444386`의 `vercel-labs/personal-agent-template`): `agent/channels/photon.ts`(핸들은 번호 또는 Apple ID이며 D2가 이를 유지함; 메시지 텍스트가 실행 제목이 되지 않도록 고정된 실행 제목; 알 수 없는 번호에 대한 낯선 사람 세션은 따르지 않음: 세션 자체를 만들지 않음)와 `app/components/profile/PhoneInput.vue`(마스크가 있는 국가 선택기; 우리 대체 입력란은 E.164 번호를 직접 받고 공백과 구두점을 제거함). OpenInstinct(`0c2a7c6e`의 `Merit-Systems/OpenInstinct`): `agent/channels/linq.ts`와 `agent/lib/linq/transport.ts`(채널 뒤의 전송 모듈 하나, `lib/server/photon.ts`가 이를 따름), 그리고 지금은 `db/services/auth/tests/linq.test.ts`, `db/services/auth/tests/linq-delivery.test.ts`, `tests/agent/channels/linq-inbound-auth.test.ts`에 있는 테스트(결과마다 테스트 하나: 거부된 포워더, 버려지는 연결되지 않은 핸들, 범위가 정해진 검증된 핸들)이며, 우리 수신기, 채널, 발신함 테스트가 그 구성을 따릅니다. `e3c01d2`의 폐기된 반복 1 설계(발신함, 확인 응답 전 내구성 있는 웹훅, 불확실한 전송 잠금)와 eve 0.80.1에 포함된 `@photon-ai/chat-adapter-imessage`(서명 방식, 네이티브 채널 동작). 2026-10-23에 읽었으며 코드는 복사하지 않았습니다 | — | 풀 리퀘스트 | — |
| 독립 검토 | 별도의 검토 에이전트가 풀 리퀘스트 전에 브랜치를 읽었습니다. 연결되지 않은 발신자, 그룹, 다른 호스트, 위조된 웹훅이 권한을 얻을 방법은 찾지 못했고, 중간 수준 6건과 낮은 수준 9건을 찾았습니다; 중간 수준 6건과 위에 표시한 낮은 수준 항목은 모두 회귀 테스트와 함께 한 커밋에서 고쳤습니다. 바꾸지 않은 것: 검토가 열린 질문으로 제기한 연결 간 잠금 대기는 구조를 바꾸는 대신 5초 잠금 제한시간으로 한정했고, 요청을 기다린 뒤 iOS Safari가 메시지를 여는지는 기기 확인에 맡깁니다 | 풀 리퀘스트를 먼저 여는 것 | 이 기록("검토"로 표시한 행); 수정 커밋 | — |
| 회선 없는 스파이크 | 회선 프로비저닝과 번호로 문자 보내기는 사용자에게 막혀 있으므로, 스파이크는 eve 0.80.1에 포함된 Photon 어댑터 소스, Photon의 웹훅 문서, Spectrum SDK 12.14.0 타입 선언, PR #23으로 어댑터를 비교했고, 기기에 의존하는 사실(딥링크 동작, 실제 iPhone의 발신자 형식, 발송 경로)은 합류 단계로 남겼습니다 | 회선을 기다린 뒤 선택 | 설계 1; 이 기록 | — |

### 사용자 대기 항목

다음 단계는 되돌려도 취소할 수 없거나, 제공자 콘솔이 필요하거나, 사람들에게 문자를 보내기 때문에 수행하지 않았습니다.

- **Photon 회선:** 프로비저닝된 회선이 없고 프로젝트 자격 증명도 설정되지 않았습니다.
- **Photon 웹훅:** `{origin}/photon/webhook`에 등록된 웹훅이 없습니다.
- **실제 번호로의 문자 발송,** 스파이크 중 포함. 통제된 iPhone을 가진 사용자가 함께 있어야 합니다.
- **공유 프로젝트 마이그레이션과 프로덕션 배포**(이 브랜치).
- **실제 기기 확인**(AC-16 ~ AC-18, 딥링크와 QR 코드, 발신자 식별자), 통제된 iPhone에서.
- **팀원 검토**(D1–D14), 이어서 변경의 `openspec archive`.

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
| 바인딩된 스레드의 코드 (검토) | 코드는 바인딩되지 않은 스레드에만 바인딩됩니다. 바인딩된 스레드에서 회신의 `Re:` 제목이나 인용문이 연결 코드를 되풀이하면, 아직 대기 중인 코드는 무효로 처리하고 메시지는 코드를 가린 채 전달합니다. 바인딩 메시지 자체는 재시도 때 절대 전달하지 않습니다 | 모든 코드를 연결 시도로 취급하기. 이 방식은 연결 이후의 모든 회신을 폐기했습니다 | 설계 5 | `lib/server/email-receipts.ts`의 `processReceivedMessage` |
| 보관 중인 알림 텍스트 (검토) | 알림은 발송 중에는 렌더링된 텍스트를 저장하지 않으며, 보낼 때마다 봉인된 매개변수로 다시 렌더링해 같은 키에는 같은 페이로드가 나옵니다 | 렌더링된 텍스트 고정하기. 이 방식은 최대 23시간 동안 쓸 수 있는 예약 링크를 남겼습니다 | 설계 6 | `lib/server/email-replies.ts`의 `renderNotice` |
| 실패한 세션과 가림 처리 (검토) | 세션이 끝내 실패한 턴 회신은 대체 문구를 즉시 보내며(훅이 깨웁니다), 턴 텍스트는 보내기 전에 가립니다 | 시도가 끝나기를 기다린 뒤 보내지 않기 | 설계 6 | `lib/server/email-replies.ts`의 `turnText`, `wakeTurnReplies` |
| 소진된 수신과 순서 (검토) | 소진된 수신은 무시됨으로 기록하고, 그 메시지가 시작한 스레드에는 고정된 회신 하나를 보냅니다. 스레드의 처리되지 않은 첫 메시지를 앞지른 회신은 재시도하며, 재시도할 수 없는 입력 거부는 무시합니다 | 결과를 비워 두기 | 설계 5 | `lib/server/email-receipts.ts`의 `createEmailReceiptHandler` |
| 자동 회신과 DMARC 정렬 (검토) | `Auto-Submitted`, `Precedence: bulk/junk/list/auto_reply`, `X-Autoreply`는 무시하며, DMARC 통과는 `dmarc_domain`이 주어진 경우 그것이 From 도메인일 때만 인정합니다 | 회신 루프를 승인 한도에 맡기기 | 설계 5 | `lib/server/email-receipts.ts`의 `autoSubmitted`; `lib/server/agentmail.ts`의 `senderAuthenticated` |
| 보관 완전성 (검토) | 정리 작업은 만료된 대기 코드도 무효로 처리하고, 30일이 지난 최종 상태가 아닌 회신과 모든 상태의 링크를 삭제합니다 | 최종 상태 행만 | 설계 9; 마이그레이션 `20261023010200_email_review_fixes.sql` | `app.cleanup_email_records` |
| 연결 잠금 순서 (검토) | 연결은 카드의 명령과 같이 링크 행보다 요청을 먼저 잠급니다 | 링크 행 먼저. 이 방식은 **이메일로 계속(Continue by email)**이나 **취소(Cancel)**와 교착될 수 있었습니다 | `lib/server/email-links.ts` | `bindByCode` |
| 수신기 입력 (검토) | 웹훅 본문은 256 KiB 상한을 두고 스트림으로 읽으며, 받은편지함 ID는 대소문자를 구분하지 않고 비교합니다 | `Content-Length` 신뢰하기 | `lib/server/agentmail-receiver.ts` | `readBody`, `receiverConfigFromEnvironment` |

### 운영 결정

| 결정 | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| 로컬 스택 | 이 브랜치의 테스트는 별도의 로컬 Supabase 스택(`project_id` `fmat-phase7`, 포트 553xx, `SUPABASE_WORKDIR`와 `TEST_DATABASE_URL`로 선택)에서 실행했습니다. 5단계 세션이 기본 로컬 스택을 공유하고 있어서 이 브랜치의 마이그레이션으로 `db reset`을 하면 그 실행이 깨지기 때문입니다 | 공유된 기본 스택 초기화 | 이 기록; 인수 기록 | — (로컬 전용) |
| 따른 참조 | `7fa24384`의 eve memory 에이전트 템플릿: `agent/lib/integrations/slack/{channel,identity}.ts`와 그 테스트, `agent/lib/testing/slack.ts`(턴 전에 애플리케이션 코드에서 신원 확인, 검증되지 않았거나 자체 작성한 메시지는 대체 principal 없이 폐기, 테스트용 타입 있는 픽스처). `3c25e62d`의 eve chat 템플릿: `agent/channels/slack.ts`(기본 내보내기 하나짜리 채널 파일) | — | 풀 리퀘스트 | — |
| A 레인 테스트 수정 | 수신기의 `environment` 열보다 먼저 작성된 A 레인 pgTAP 테스트를 첫 B 레인 커밋에서 고쳤습니다 | 기록을 다시 쓰게 되는 A 레인 커밋 수정(amend) | B 레인 커밋 메시지 | — |
| 독립 검토 | 별도의 검토 에이전트가 풀 리퀘스트 전에 브랜치를 읽었으며, 높음 등급 발견(연결 이후 회신 폐기)과 확인된 중간·낮음 등급 발견은 회귀 테스트와 새 마이그레이션 하나와 함께 한 커밋에서 고쳤습니다 | 풀 리퀘스트를 먼저 열기 | 이 기록(“검토”로 표시된 행); 수정 커밋 | — |
| 5단계 이후 마이그레이션 순서 | 5단계가 먼저 병합되어, 7단계 마이그레이션 세 개를 `20261023010000_email_ingress.sql`, `20261023010100_email_threads.sql`, `20261023010200_email_review_fixes.sql`로 이름을 바꿔 `20261022132708_agent_access.sql` 뒤에 오게 했습니다. 내용은 바뀌지 않았고, 브랜치에 이미 푸시된 병합이 있었으므로 리베이스하지 않고 `main`을 병합했습니다 | 기존 타임스탬프를 유지하기(5단계 것과 뒤섞임) | 이 기록; 병합 커밋 | — |

### 사용자 대기 항목

다음 단계는 되돌려도 취소할 수 없거나, 제공자 콘솔이 필요하거나, 팀 밖의 사람에게 발송되기 때문에 수행하지 않았습니다.

- **AgentMail 받은편지함:** `findmeatime@agentmail.to`는 만들지 않았습니다. 계정이 받은편지함 세 개 한도에 도달했고, 받은편지함을 비우거나 만드는 일은 되돌릴 수 없습니다.
- **AgentMail 웹훅:** AgentMail에 등록한 웹훅이 없고, 공유 프로젝트에 등록한 수신기도 없습니다.
- **공유 프로젝트 마이그레이션과 프로덕션 배포:** 이 브랜치의 것.
- **실제 다중 턴 받은편지함 전달:** 팀이 통제하는 주소로 하는 증거(7단계 증거)이며, 받은편지함, 웹훅, 배포가 필요합니다.
- **팀원 검토:** D1–D11에 대한 검토, 이어서 변경의 `openspec archive`.

## 8단계 — `operations-and-release`

[제안서](../../openspec/changes/operations-and-release/proposal.md#decisions)가 D1–D14를 기록합니다. 계획은 D1–D4와 보존 및 삭제 규칙을 이 단계에 배정했고 나머지는 설계에서 제기되었습니다. 구현을 맡은 세션이 사용자의 지시(모든 결정을 기록하고 바꿀 수 있게 유지)에 따라 2026-10-23에 이를 정했으며, 아직 팀원 검토를 받은 결정은 없습니다.

### 제품 결정

| # | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| D1 | 측정 기간: 첫 외부 호스트가 릴리스 환경에 합류한 날부터 8주, 매주 보고 | 고정된 분기 단위 달력 기간; 첫 배포부터 측정 | 제안서; 설계 1; PRD 2절 | PRD와 설계 1 |
| D2 | 목표: 예약된 요청당 호스트 조치 중앙값 2회 이하; 유효한 요청의 50 % 이상 예약; 제출부터 예약까지 중앙값 24시간 이하, p90 72시간 이하; 코드로 확인되는 제약에 대한 실행 불가능한 제안 0건; 신뢰 사고 0건. 전환율이나 속도 미달은 롤백이 아니라 검토를 시작 | 성숙한 일정 조율 제품에서 가져온 목표; 데이터가 생길 때까지 목표 없음 | 제안서; 설계 1; PRD 2절 | PRD와 설계 1 |
| D3 | 주마다 순환하는 운영자 한 명이 매일 스냅샷을 읽고, 영업일 기준 이틀 안에 지원에 답하며, 자기 토큰으로 복구를 실행합니다. 저장소 소유자는 배포, 릴리스 마이그레이션, DNS, 콘솔을 계속 맡습니다. 지원은 `support@findmeatime.com`(Cloudflare Email Routing 별칭, 아직 만들지 않음) | 공유 개인 받은편지함; GitHub 이슈; 온콜 | 제안서; 설계 2; PRD 10절 | 설계 2와 `apps/web/app/privacy/`의 고지 |
| D4 | `npm run perf:check`: 공개 경로마다 순차 샘플 20회에서 p50 800 ms 이하, p95 2,000 ms 이하; 승인부터 확정까지 2분 이내, 첫 스트리밍 회신은 p95 기준 10초 이내이며, 도구가 생길 때까지 측정되지 않음으로 보고 | 프로덕션 대상 부하 테스트; 출시 전 목표 없음 | 제안서; 설계 3; PRD 10절 | `scripts/perf-check.ts`의 `TARGETS` |
| D5 | 고정된 스냅샷 범주 열 가지, 오래된 것부터, 식별자 최대 20개, 페이로드나 실패 텍스트 없음 | 종류별 세부 분류; 제공자 읽기 | 제안서; 설계 4; `operational-diagnostics` 델타 | `app.operator_diagnostics_snapshot`과 새 마이그레이션 |
| D6 | 거절은 명령 파이프라인에서 집계(`unauthenticated`, `forbidden`; `stale_revision`, `request_closed`). `DIAGNOSTICS_REJECTIONS=1`일 때, 500 ms 제한, 시간별 24개 버킷이 10,000에서 포화 | 애플리케이션에 없는 데이터베이스 RPC 집계; 메모리 내 카운터 | 제안서; 설계 5; `operational-diagnostics` 델타 | `lib/server/diagnostics.ts`의 `REJECTION_CATEGORIES` |
| D7 | `recover job`은 소진된 작업에만(새 시도 1~10회); `recover booking`은 라이브 작업이 없는 dispatching 예약에만 쓰이며 조정 작업 하나를 게시. 불확실한 메시지는 다시 보내지 않음; `operator_operations`에 감사 기록 | 예약의 수동 확정 또는 실패 처리; 불확실한 메시지 재전송 | 제안서; 설계 6; `operational-recovery` 델타 | `lib/server/recovery-operations.ts`와 운영자 함수 |
| D8 | `pg_dump`와 `pg_restore`로 합성 데이터를 채운 별도 로컬 데이터베이스에 복원 훈련; 호스팅 백업은 새 프로젝트에만 복원 | 공유 프로젝트의 사본으로 훈련 | 제안서; 설계 7; `data-stewardship` 델타 | `scripts/restore-drill.ts` |
| D9 | 종료된 요청은 종료 90일 뒤; 끝난 작업, 명령 결과, 시도 기록은 30일; 소진된 작업과 모델 예약은 90일; 운영자 감사는 1년; 시간별 패스 | 요청은 1년; 종료 시 삭제 | 제안서; 설계 8; PRD 8절 | `app.cleanup_retained_records`와 새 마이그레이션 |
| D10 | `delete-host`와 `delete-request`를 통한 요청 시 삭제. 삭제된 호스트는 핸들 이력과 함께 정지된, 이름 없는 계정 행을 남기며 복원할 수 없음 | 플래그를 쓰는 소프트 삭제; 핸들 이력 삭제 | 제안서; 설계 9; `data-stewardship` 델타 | `app.operator_delete_host`와 `app.operator_delete_request` |
| D11 | 저장을 끈 OpenAI 직접 호출; API 데이터로 학습하지 않음; 최대 30일의 악용 모니터링 로그; 무보존 주장은 하지 않음; 런타임 자체의 세션 사본은 패스 밖이라고 고지 | 무보존을 주장; 게이트웨이 경유 | 제안서; 설계 10; PRD 8절 | 고지 |
| D12 | 영어와 한국어의 `/privacy`, `/`, 호스트 페이지, 예약 페이지, **Continue with Google** 카드에서 링크; 동의 체크박스 없음 | 접수 단계의 동의 체크박스; 영어만 | 제안서; 설계 11; 페이지 목록 P11 | `apps/web/app/privacy/` |
| D13 | 릴리스: `findmeatime-release` 뒤의 `mriseqztcwmezvtawnbo`; 스테이징: `dev.findmeatime.com`의 `findmeatime-dev` 뒤의 공유 프로젝트; 릴리스 마이그레이션은 환경 승인을 거치는 수동 워크플로로 | 단일 환경 유지; 릴리스용 두 번째 Vercel 프로젝트 | 제안서; 설계 12; 제공자 설정 | `.github/workflows/deploy-release.yml`과 제공자 설정 |
| D14 | `APP_ORIGIN`이 설정되어 있지만 릴리스 출처가 아닌 프로덕션 배포는 스테이징이며 메시지 발송이 거부됨 | 릴리스 프로젝트의 새 옵트인 변수. 설정할 때까지 프로덕션 메일이 멈추게 됨 | 제안서; 설계 12; `messaging-environments` 델타 | `lib/server/messaging.ts`의 `RELEASE_ORIGINS` |

### 구현 결정

| 결정 | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| 스냅샷 형태 | `app.operator_diagnostics_snapshot`이 만드는 `jsonb` 객체 하나이며, `app.diagnostics_category`가 상수 쿼리 열 개로 구성합니다. 세션은 런타임 세션 ID가 아니라 저장된 해시로 식별합니다 | 범주마다 뷰 하나; CLI에서 범주마다 쿼리 하나 | `supabase/schemas/app/functions/operator_diagnostics.sql` | 함수와 새 마이그레이션 |
| 버킷 정렬 | `date_bin('1 hour', …, '2000-01-01 00:00:00+00')`, 세션 시간대에 의존하지 않으며 테이블의 체크 제약에도 사용합니다 | `date_trunc('hour', …)`, 세션의 `TimeZone`을 따릅니다 | `rejection_observations` 스키마 | 테이블, 함수, 새 마이그레이션 |
| 수집 지점 | `runCommand`에서 `commandFailure` 뒤에, `deps.db`(풀)와 `deps.env`로 실행하므로 롤백된 명령 트랜잭션이 횟수를 잃게 하지 않고 테스트의 환경이 결정합니다 | 명령 트랜잭션 안; 각 라우트 안 | `lib/server/commands.ts` | `lib/server/diagnostics.ts`의 `observeRejection` |
| CLI 구성 | 공유 헬퍼는 `lib/server/operator-shared.ts`로 옮기고, 진단은 `lib/server/diagnostics-admin.ts`에 두며, `operator.ts`는 첫 단어로 분기합니다 | 계속 커지는 `operator.ts` 하나 | 해당 모듈들 | — |
| 출력 | 기본은 읽기 쉬운 줄이고, `--json`은 환경을 더한 데이터베이스의 객체를 출력합니다. 모두 0인 스냅샷은 정상의 증거가 아님을 출력합니다 | JSON만 | `lib/server/diagnostics-admin.ts` | 같은 파일의 `printSnapshot`과 `printRejections` |

### 운영 결정

| 결정 | 선택 | 대안 | 기록된 위치 | 바꾸는 방법 |
|---|---|---|---|---|
| 릴리스 프로젝트 점검 | 저장소를 프로젝트에 연결하지 않고 2026-10-23에 `supabase db query --linked --project-ref mriseqztcwmezvtawnbo`로 읽기 전용 쿼리를 실행했으며, CLI가 프로젝트에 임시 `cli_login_postgres` 로그인 역할을 만들었습니다 | 체크아웃을 프로젝트에 연결하기 | 설계 12; 제공자 설정 | — |
| 공유 프로젝트 상태 | 2026-10-23의 읽기 전용 쿼리에서 6단계의 `20261023024435_imessage_channel.sql`까지 모든 마이그레이션이 이미 `anelszynxtvxoxqvzgqt`에 적용되어 있음을 확인했습니다. `Deploy shared Supabase` 워크플로는 비밀이 없어 푸시마다 여전히 실패하는데도 그렇습니다. 이 단계는 마이그레이션을 하나 더 추가하며, 아직 적용되지 않았습니다 | 6단계와 7단계 마이그레이션이 빠져 있다고 가정하기 | 이 기록 | — |
| 루트 도메인 | 반복하지 않음: `findmeatime.com`과 `release.findmeatime.com`은 2026-10-19부터 `findmeatime-release`에 있으며, 2026-10-23에 읽기 전용으로 확인했습니다 | 도메인 다시 연결 | 설계 12; 인수 기록 | — |

### 사용자 대기 항목

다음 단계는 되돌려도 취소할 수 없거나, 제공자 콘솔이 필요하거나, 공유 환경 또는 릴리스 환경을 바꾸기 때문에 수행하지 않았습니다. 릴리스가 필요로 하는 순서대로 나열합니다.

1. `Deploy shared Supabase`용 **저장소 비밀과 변수**: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `WORKER_URL`, `WORKER_SECRET`, `GOOGLE_CLIENT_SECRET`, 그리고 변수 `SUPABASE_AUTH_SITE_URL`, `SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS`, `GOOGLE_CLIENT_ID`. 그때까지 이 단계의 마이그레이션은 수동으로만 공유 프로젝트에 닿습니다.
2. **`main`의 프로덕션 배포**: 현재 `findmeatime-release`의 프로덕션 배포(2026-10-23 07:02 KST, CLI 배포)는 6단계 병합보다 앞선 것입니다.
3. D1–D14에 대한 **팀원 검토**, 이어서 `openspec archive operations-and-release`.
