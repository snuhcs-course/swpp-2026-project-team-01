> 이 문서는 [영문 원본](../../../documentations/technical_specification/09_agent_clients.md)의 검토용 번역입니다. 영문이 기준입니다.

# Find Me a Time — 개인 에이전트 클라이언트

상태: 연결 경로 작성 완료; 명시된 클라이언트의 실행 검증은 아직 없음\
날짜: 2026-11-18\
함께 보기: [`agent-access` 설계](../../openspec/changes/agent-access/design.md#11-per-client-acceptance), [CLI 방향](05_cli.md), [인수 기록](07_acceptance_record.md)

이 문서는 PRD FR-24의 각 클라이언트가 안내를 찾고 연결하는 방법과 역할별 마지막 실행 결과를 기록합니다. AC-14, AC-15 및 AC-19~AC-25의 클라이언트별 인수 계획입니다. 팀원이 실행하고 인수 기록에 근거를 남길 때까지 행에는 “아직 실행하지 않음”을 표시하며, 그 전에 동작을 보장하지 않습니다.

## 모든 클라이언트에 제공되는 것

| 역할 | 안내 | MCP 엔드포인트 | 권한 |
|---|---|---|---|
| 호스트 | `https://findmeatime.com/SKILL.md`, `https://findmeatime.com`에서 연결 | `https://findmeatime.com/mcp` | `host:read`, `host:write`, `host:decide` |
| 계정 요청자 | `https://findmeatime.com/{handle}/SKILL.md` | 기존 `https://findmeatime.com/mcp` | 명시적인 `request:read`, `request:write`, `request:decide` |
| 비회원 요청자 | `https://findmeatime.com/{handle}/SKILL.md`, `https://findmeatime.com/{handle}`에서 연결 | `https://findmeatime.com/{handle}/mcp` | `request:read`, `request:write`, `request:decide` |

두 엔드포인트 모두 OAuth와 Streamable HTTP를 통해 MCP `2026-07-28` 및 핸드셰이크 버전 `2025-11-25`, `2025-06-18`, `2025-03-26`을 지원합니다. 클라이언트는 클라이언트 ID 메타데이터 문서나 동적 등록으로 등록하고, 브라우저에서 동의 화면을 열며, 해당 엔드포인트에 한정된 토큰을 받습니다. 원격 MCP를 사용할 수 없으면 안내를 읽고 웹으로 이동할 수 있습니다. 셸만 있는 에이전트에는 `fmat` CLI 경로가 있습니다.

진입 문서(안내 버전 6)는 서버 추가 전에 동의를 구하고 토큰을 직접 다루지 않도록 안내합니다. 연결 후 호스트 에이전트는 `get_host_status`로 시작하여 `get_setup.nextStep`에 따라 캘린더 연결·선택·분석을 진행하고, 호스트가 동의한 설정만 제안합니다. `update_setup_field`와 `confirm_setup`에는 호스트 본인의 말인 `hostWords`가 필요하며, 이 말은 저장되지 않습니다. 설정 후 예약 링크를 공유하고 요청 확인은 호스트가 요청해야 한다고 알립니다. 에이전트에는 자동 알림이 없습니다. 호스트의 캘린더에 무엇이 있는지 물으면 `get_schedule`(`host:read`, 읽기 전용)을 호출하며, 이 도구는 Dashboard와 같은 라벨이 붙은 기간을 반환합니다: Find Me a Time 미팅, 호스트가 고른 Google Calendar의 다른 일정, 결정을 기다리는 받은 요청, 보낸 요청.

채팅 연결에는 호스트가 `start_chat_link`(iMessage, WhatsApp, Telegram), 요청자는 요청 생성 후 `start_updates_link`(iMessage 또는 WhatsApp)를 사용합니다. 도구는 한 시도에 한정된 단기 `/connect/link/{token}` 브라우저 링크를 반환합니다. 사용자는 자기 전화로 코드를 보내고 가려진 발신자를 확인한 뒤 **Confirm and link**를 누릅니다. 호스트는 해당 계정 로그인이 필요하며, 요청자 링크는 예약 링크나 요청 내용을 노출하지 않고 해당 시도만 승인합니다. `get_host_status.chat`과 `get_request.updates`는 `none`, `pending`, `linked`를 보고합니다. 에이전트는 연결을 직접 확정하지 않습니다. 요청자가 시간에 동의하면 호스트 승인이 더 필요하고 아직 예약되지 않았으며 이메일로 결과가 온다고 안내합니다. 사용자는 나중에 다시 조회를 요청할 수 있습니다.

## 호스팅과 예약 요청을 계정 연결 하나로 처리

계정 연결은 `/mcp`에서 요청자 권한에 명시적으로 동의할 수 있습니다. 기존 호스트 전용 토큰에는 권한이 추가되지 않으며, 갱신으로도 범위를 넓힐 수 없습니다. 같은 서버에서 원하는 요청자 권한으로 재인증합니다. Codex에서는 `codex mcp login findmeatime --scopes host:read,host:write,host:decide,request:read,request:write,request:decide`로 두 역할을 요청합니다. 추가 권한을 요청할 때 기존 호스트 권한 선택을 존중합니다. 브라우저 동의가 한 번 필요하며 호스트마다 서버를 추가하지 않습니다.

`get_host({hostHandle})` 후 `create_request({hostHandle, name, email, timezone, details?, language?, retryKey})`를 사용합니다. 새 미팅에는 새 재시도 키를 사용합니다. 동일한 재시도는 같은 요청을 반환하고, 인자가 달라지면 충돌합니다. 비공개 계속하기 링크는 이메일로만 보내며 에이전트에 반환하지 않습니다. 자기 자신에게 예약하는 것은 거부합니다.

`list_sent_requests({limit?, offset?})`는 접근 기한이 남은 검증된 계정 연결 요청을 나열합니다. `get_sent_request({requestId})`로 하나를 읽습니다. 요청자 작업은 `{requestId, arguments: {retryKey, expectedRevision?, input?}}` 형식을 사용하며, 중첩 인자는 비회원 도구의 스키마를 유지합니다. 보낸 예약 작업은 `check_sent_booking`, `cancel_sent_booking`, `change_sent_booking`입니다. 기존 받은 요청 도구인 `get_request`, `cancel_booking`, `change_booking`, `check_booking`은 호스트 의미를 유지합니다. 이 동의로 계정의 캘린더가 요청에 공유되지는 않습니다.

서비스는 보낸 요청을 호출할 때마다 검증된 계정 연결과 비공개 링크의 유효 기한을 확인합니다. 연락 이메일 일치만으로 소유권이 생기지 않습니다. 읽기·쓰기·결정 권한은 분리되며, 정확한 제안에 대한 요청자 동의와 상대 호스트 승인이 모두 필요합니다. 비회원 호스트별 엔드포인트는 미래 요청 하나 모델을 유지합니다. 로컬 통합 테스트는 `tests/integration/agent-mcp-account-requester.test.ts`이며, 명시된 클라이언트의 운영 환경 인수 검증은 남아 있습니다.

## 테스트 환경

[`agent-access` 제안](../../openspec/changes/agent-access/proposal.md#decisions)의 D16 결정:

- **장소:** 마이그레이션 및 `AGENT_TOKEN_SIGNING_KEY`와 함께 `agent-access`가 배포된 운영 환경 `https://findmeatime.com`.
- **주체:** 설정을 완료한 팀 호스트 계정과 팀에서 제어하는 요청자 이메일함. 각 클라이언트는 팀원의 계정과 현재 공개 버전으로 실행합니다.
- **실행별 기록:** 클라이언트와 버전 또는 날짜, 계정 요금제, 안내 발견 경로(일반 URL 또는 명시적 `/SKILL.md`), 인증 서버가 기록한 등록 방식(메타데이터 문서 또는 동적 등록)과 리디렉션 호스트, 요청 권한, 호스트 역할 결과(AC-14, AC-19, AC-20, AC-22, AC-23), 요청자 역할 결과(AC-14, AC-15, AC-21, AC-22, AC-24), 동의 거부와 이용 불가 호스트 검사(AC-25).
- **프롬프트:** 호스트는 “Let me use findmeatime.com for my scheduling”, 요청자는 “Let me schedule a meeting with findmeatime.com/{handle}”. AC-23, AC-24에 따라 충분한 정보가 있는 경우와 정보가 빠진 경우를 모두 실행합니다.

## 클라이언트

다음 연결 경로는 각 클라이언트 문서의 원격 MCP 방법이며, 첫 실행에서 확인하거나 수정합니다.

| 클라이언트 | 시도할 연결 경로 | 호스트 역할 | 요청자 역할 |
|---|---|---|---|
| Claude Code | `claude mcp add --transport http findmeatime https://findmeatime.com/mcp` 후 `/mcp`에서 서버 선택 및 브라우저 인증; 요청자: `claude mcp add --transport http findmeatime-{handle} https://findmeatime.com/{handle}/mcp`. `/mcp`에 없으면 재시작 후 대화 계속 | 아직 실행하지 않음 | 아직 실행하지 않음 |
| Claude | MCP 엔드포인트 URL을 사용하는 사용자 지정 커넥터 | 아직 실행하지 않음 | 아직 실행하지 않음 |
| ChatGPT | MCP 엔드포인트 URL을 사용하는 개발자 모드 커넥터 | 아직 실행하지 않음 | 아직 실행하지 않음 |
| Codex | `codex mcp add findmeatime --url <endpoint>`로 브라우저 인증(CLI 0.169.0); 미완료 시 `codex mcp login findmeatime --scopes <the role's scopes>`; 또는 셸의 CLI | 아직 실행하지 않음 | 아직 실행하지 않음 |
| Dots | 첫 실행에서 확인: 원격 MCP 지원 시 사용, 아니면 안내와 웹 경로 | 아직 실행하지 않음 | 아직 실행하지 않음 |
| Muse | 첫 실행에서 확인: 원격 MCP 지원 시 사용, 아니면 안내와 웹 경로 | 아직 실행하지 않음 | 아직 실행하지 않음 |
| Instinct | 첫 실행에서 확인: 원격 MCP 지원 시 사용, 아니면 안내와 웹 경로 | 아직 실행하지 않음 | 아직 실행하지 않음 |

확인되지 않은 클라이언트는 [구현 계획](06_implementation_plan.md#phase-5--agent-access)에 명시된 출시 차단 항목입니다.

## 실행에서 확인할 것

- 에이전트가 일반 URL에서 안내를 찾는지 확인합니다. 실패하면 명시적 `/SKILL.md`로 재시도하고 기록합니다.
- 연결 시 클라이언트 이름과 리디렉션 호스트를 표시하는 동의 화면이 나오며, **Deny**를 누르면 연결되지 않습니다.
- 호스트 역할: 설정과 요청을 읽고, 다른 호스트의 요청은 볼 수 없으며, 호스트가 본인의 말로 지시할 때만 해당 말을 전달하여 승인·거절합니다. 조건부 승인에는 다시 질문합니다([`agent-decisions-in-words`](../../openspec/changes/agent-decisions-in-words/proposal.md)).
- 요청자 역할: 사용자 본인의 정보로 요청 하나를 만들고 부족한 정보는 질문하며, 허용 범위에서 시간을 선택하고 사용자가 수락한 시간에만 동의합니다. 호스트 승인 후 서비스가 예약 완료를 표시할 때만 예약되었다고 알립니다.
- **Connected agents**에서 연결을 취소하면 다음 호출부터 차단됩니다.
