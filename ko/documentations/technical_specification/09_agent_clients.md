> 한국어 번역본 (검토용). 원본: documentations/technical_specification/09_agent_clients.md

# Find Me a Time — 개인 에이전트 클라이언트

상태: 연결 경로 작성 완료. 아직 명시된 클라이언트를 실행하지 않음\
날짜: 2026-11-14\
함께 읽기: [`agent-access` 설계](../../openspec/changes/agent-access/design.md#11-per-client-acceptance), [CLI 방향](05_cli.md), [인수 기록](07_acceptance_record.md)

이 문서는 PRD FR-24에 명시된 각 클라이언트가 Find Me a Time 지침을 찾는 방법, 연결하는 방법, 각 역할에서 마지막으로 실행한 결과를 기록한다. AC-14, AC-15, AC-19부터 AC-25까지의 클라이언트별 인수 계획이다. 팀원이 실행하고 인수 기록에 증거를 남기기 전까지 각 행은 “아직 실행하지 않음”으로 유지한다. 실행하기 전에 클라이언트가 동작한다고 주장하지 않는다.

## 모든 클라이언트에 제공되는 것

| 역할 | 지침 | MCP 엔드포인트 | 권한 |
|---|---|---|---|
| 호스트 | `https://findmeatime.com/SKILL.md`, 연결 위치: `https://findmeatime.com` | `https://findmeatime.com/mcp` | `host:read`, `host:write`, `host:decide` |
| 요청자 | `https://findmeatime.com/{handle}/SKILL.md`, 연결 위치: `https://findmeatime.com/{handle}` | `https://findmeatime.com/{handle}/mcp` | `request:read`, `request:write`, `request:decide` |

두 엔드포인트는 Streamable HTTP와 OAuth를 통해 MCP `2026-07-28` 및 핸드셰이크 리비전 `2025-11-25`, `2025-06-18`, `2025-03-26`을 지원한다. 클라이언트는 클라이언트 ID 메타데이터 문서 또는 동적 클라이언트 등록으로 등록하고, 사용자의 브라우저에서 동의 페이지를 열며, 해당 엔드포인트 하나에 묶인 토큰을 받는다. 원격 MCP 서버를 사용할 수 없는 클라이언트도 지침을 읽고 사용자를 웹 페이지로 안내할 수 있다. 셸만 사용할 수 있는 에이전트는 CLI `fmat`을 이용한다.

진입 문서(지침 버전 5)는 서버를 추가하기 전에 사용자에게 묻고 토큰을 직접 취급하지 말라고 안내한다. 연결 후 호스트의 에이전트는 `get_host_status`로 시작하여 `get_setup.nextStep`에 따라 Calendar 연결, 캘린더 선택, 분석을 진행하고, 호스트의 동의를 받아서만 설정을 제안한다. `update_setup_field`와 `confirm_setup`에는 호스트 자신의 말을 담은 `hostWords`가 필요하며 이 말은 저장하지 않는다. 설정 후 예약 링크를 전달하고, 에이전트는 알림을 받지 않으므로 요청을 확인하고 싶을 때 물어보라고 호스트에게 안내한다.

채팅 연결 시 호스트의 에이전트는 `start_chat_link`(iMessage, WhatsApp 또는 Telegram)를 호출한다. 요청자의 에이전트는 요청이 만들어진 뒤 `start_updates_link`(iMessage 또는 WhatsApp)를 호출한다. 도구는 시도 하나에만 유효한 짧은 수명의 `/connect/link/{token}` 브라우저 링크를 반환한다. 사용자는 자신의 휴대전화로 코드를 보내고, 마스킹된 발신자를 확인한 뒤 그 페이지에서 **Confirm and link**를 누른다. 호스트 연결에는 해당 호스트의 로그인이 필요하다. 요청자 링크는 예약 링크나 요청 세부 정보를 보여주지 않고 해당 시도만 허용한다. `get_host_status.chat`과 `get_request.updates`는 `none`, `pending`, `linked`를 보고한다. 에이전트는 연결을 확정하지 않는다. 요청자가 시간에 동의한 뒤에는 서비스의 다음 단계가 호스트의 승인이 여전히 필요하고 아직 예약되지 않았으며 결과는 이메일로 온다고 안내한다. 사용자는 에이전트에게 다시 확인해 달라고 요청할 수 있다.

## 테스트 환경

결정 근거: [`agent-access` 제안](../../openspec/changes/agent-access/proposal.md#decisions) (D16):

- **장소:** 운영 환경, `https://findmeatime.com`, `agent-access` 변경과 마이그레이션, `AGENT_TOKEN_SIGNING_KEY`가 배포된 이후.
- **대상:** 설정을 마친 팀 호스트 계정과 팀에서 관리하는 요청자 받은편지함. 각 클라이언트는 팀원 자신의 계정으로 최신 공개 버전을 실행한다.
- **실행마다 기록할 것:** 클라이언트와 버전 또는 날짜, 계정 요금제, 지침을 찾은 방법(일반 URL 또는 명시적인 `/SKILL.md` 형식), 인증 서버가 기록한 등록 방식(메타데이터 문서 또는 동적 등록)과 리디렉션 호스트, 요청한 권한, 호스트 역할 결과(AC-14, AC-19, AC-20, AC-22, AC-23), 요청자 역할 결과(AC-14, AC-15, AC-21, AC-22, AC-24), 동의 거부 및 사용 불가 호스트 확인(AC-25).
- **프롬프트:** "Let me use findmeatime.com for my scheduling" (호스트) 및 "Let me schedule a meeting with findmeatime.com/{handle}" (요청자). AC-23과 AC-24에 따라 먼저 충분한 맥락으로 실행하고, 이후 세부 정보 하나를 생략하여 실행한다.

## 클라이언트

아래 연결 경로는 각 클라이언트의 공식 문서가 제공하는 원격 MCP 서버 연결 방식이다. 첫 실행에서 이를 확인하거나 수정한다.

| 클라이언트 | 시도할 연결 경로 | 호스트 역할 | 요청자 역할 |
|---|---|---|---|
| Claude Code | `claude mcp add --transport http findmeatime https://findmeatime.com/mcp`, 이후 `/mcp`에서 서버를 선택하고 브라우저로 인증한다. 요청자: `claude mcp add --transport http findmeatime-{handle} https://findmeatime.com/{handle}/mcp`. `/mcp`에 서버가 없으면 Claude Code를 다시 시작하고 계속한다 | 아직 실행하지 않음 | 아직 실행하지 않음 |
| Claude | MCP 엔드포인트 URL을 지정하는 사용자 지정 커넥터 | 아직 실행하지 않음 | 아직 실행하지 않음 |
| ChatGPT | MCP 엔드포인트 URL을 지정하는 커넥터(개발자 모드) | 아직 실행하지 않음 | 아직 실행하지 않음 |
| Codex | `codex mcp add findmeatime --url <endpoint>`, 실행하면 브라우저가 열려 인증 진행(CLI 0.169.0). 끝나지 않았으면 `codex mcp login findmeatime --scopes <역할의 권한>`. 지원하지 않으면 셸에서 CLI 사용 | 아직 실행하지 않음 | 아직 실행하지 않음 |
| Dots | 첫 실행에서 확인: 지원하면 원격 MCP, 지원하지 않으면 지침과 웹에서 계속하기 | 아직 실행하지 않음 | 아직 실행하지 않음 |
| Muse | 첫 실행에서 확인: 지원하면 원격 MCP, 지원하지 않으면 지침과 웹에서 계속하기 | 아직 실행하지 않음 | 아직 실행하지 않음 |
| Instinct | 첫 실행에서 확인: 지원하면 원격 MCP, 지원하지 않으면 지침과 웹에서 계속하기 | 아직 실행하지 않음 | 아직 실행하지 않음 |

[구현 계획](06_implementation_plan.md#phase-5--agent-access)에 명시된 대로, 확인하지 못한 클라이언트는 릴리스를 막는 사안이다.

## 실행 시 확인할 사항

- 에이전트가 일반 URL에서 지침을 찾는지 확인한다. 찾지 못하면 명시적인 `/SKILL.md` 형식으로 다시 실행하고 이를 기록한다.
- 연결 시 클라이언트 이름과 리디렉션 호스트가 있는 동의 페이지가 표시되는지 확인한다. **Deny**를 누르면 아무것도 연결되지 않는다.
- 호스트 역할: 에이전트는 설정과 요청을 읽고 다른 호스트의 요청은 볼 수 없다. 호스트가 자신의 말로 지시했을 때만 그 말을 전달하여 승인하거나 거절한다. 조건부 승인을 요청받으면 호스트에게 다시 묻는다([`agent-decisions-in-words`](../../openspec/changes/agent-decisions-in-words/proposal.md)).
- 요청자 역할: 에이전트는 사용자 자신의 정보로 요청 하나를 만들고, 빠진 정보는 물어보며, 사용자가 허용한 범위에서 선택한다. 사용자가 받아들인 시간에만 동의하고 호스트가 승인하여 서비스에 예약 완료로 표시된 뒤에만 예약되었다고 말한다.
- **Connected agents**에서 연결을 철회하면 에이전트의 다음 호출이 차단된다.
