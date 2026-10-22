> 한국어 번역본 (검토용). 원본: documentations/technical_specification/09_agent_clients.md

# Find Me a Time — 개인 에이전트 클라이언트

상태: 연결 경로 작성됨; 이름이 지정된 클라이언트는 아직 실행되지 않음\
날짜: 2026-10-22\
관련 문서: [`agent-access` 설계](../../openspec/changes/agent-access/design.md#11-per-client-acceptance), [CLI 방향](05_cli.md), [인수 기록](07_acceptance_record.md)

이 문서는 PRD FR-24에 이름이 오른 각 클라이언트가 Find Me a Time 지침을 어떻게 찾고, 어떻게 연결하며, 각 역할에서 마지막으로 실행한 결과가 무엇인지를 기록합니다. AC-14, AC-15, AC-19부터 AC-25까지의 클라이언트별 인수 계획입니다. 팀원이 실행하고 그 증거를 인수 기록에 남기기 전까지 행에는 "아직 실행되지 않음"이라고 적히며, 그 전에는 어떤 클라이언트도 동작한다고 주장하지 않습니다.

## 모든 클라이언트가 받는 것

| 역할 | 지침 | MCP 엔드포인트 | 권한 |
|---|---|---|---|
| 호스트 | `https://findmeatime.com/SKILL.md`, `https://findmeatime.com`에서 링크됨 | `https://findmeatime.com/mcp` | `host:read`, `host:write`, `host:decide` |
| 요청자 | `https://findmeatime.com/{handle}/SKILL.md`, `https://findmeatime.com/{handle}`에서 링크됨 | `https://findmeatime.com/{handle}/mcp` | `request:read`, `request:write`, `request:decide` |

두 엔드포인트는 모두 OAuth를 사용하는 Streamable HTTP로 MCP `2026-07-28`과 핸드셰이크 리비전 `2025-11-25`, `2025-06-18`, `2025-03-26`을 지원합니다. 클라이언트는 클라이언트 ID 메타데이터 문서 또는 동적 클라이언트 등록으로 등록하고, 사람의 브라우저에서 동의 페이지를 열며, 그 한 엔드포인트에 바인딩된 토큰을 받습니다. 원격 MCP 서버를 사용할 수 없는 클라이언트도 지침을 읽고 사람을 웹 페이지로 안내할 수 있으며, 셸만 가진 에이전트에게는 CLI `fmat`이 경로입니다.

## 테스트 환경

[`agent-access` 제안](../../openspec/changes/agent-access/proposal.md#decisions)에서 결정했습니다(D16).

- **장소:** 프로덕션 `https://findmeatime.com`, `agent-access` 변경이 마이그레이션 및 `AGENT_TOKEN_SIGNING_KEY`와 함께 배포된 뒤.
- **주체:** 설정을 마친 팀 호스트 계정과 팀이 관리하는 요청자 받은편지함. 각 클라이언트는 현재 공개 버전으로 팀원 본인의 계정 아래에서 실행합니다.
- **실행마다 기록할 것:** 클라이언트와 그 버전 또는 날짜, 계정 플랜, 지침을 찾은 방법(일반 URL 또는 명시적 `/SKILL.md` 형태), 인가 서버가 기록한 등록 방식(메타데이터 문서 또는 동적 등록)과 리디렉션 호스트, 요청한 권한, 호스트 역할 결과(AC-14, AC-19, AC-20, AC-22, AC-23)와 요청자 역할 결과(AC-14, AC-15, AC-21, AC-22, AC-24), 그리고 동의 거부 및 호스트 이용 불가 점검(AC-25).
- **프롬프트:** "Let me use findmeatime.com for my scheduling"(호스트)와 "Let me schedule a meeting with findmeatime.com/{handle}"(요청자)를, AC-23과 AC-24가 설명하듯 먼저 충분한 맥락으로, 이어서 세부 정보 하나를 빼고 실행합니다.

## 클라이언트

아래 각 연결 경로는 해당 클라이언트의 자체 문서가 원격 MCP 서버에 대해 제시하는 방법이며, 첫 실행에서 이를 확인하거나 바로잡습니다.

| 클라이언트 | 시도할 연결 경로 | 호스트 역할 | 요청자 역할 |
|---|---|---|---|
| Claude Code | `claude mcp add --transport http findmeatime https://findmeatime.com/mcp`, 이어서 `/mcp`로 인증; 요청자 엔드포인트도 같은 방식 | 아직 실행되지 않음 | 아직 실행되지 않음 |
| Claude | MCP 엔드포인트 URL을 넣은 커스텀 커넥터 | 아직 실행되지 않음 | 아직 실행되지 않음 |
| ChatGPT | MCP 엔드포인트 URL을 넣은 커넥터(개발자 모드) | 아직 실행되지 않음 | 아직 실행되지 않음 |
| Codex | 설정에 엔드포인트 URL을 넣은 Streamable HTTP MCP 서버; 그렇지 않으면 셸을 통한 CLI | 아직 실행되지 않음 | 아직 실행되지 않음 |
| Dots | 첫 실행에서 확인: 제공되면 원격 MCP, 아니면 지침과 웹 이어가기 | 아직 실행되지 않음 | 아직 실행되지 않음 |
| Muse | 첫 실행에서 확인: 제공되면 원격 MCP, 아니면 지침과 웹 이어가기 | 아직 실행되지 않음 | 아직 실행되지 않음 |
| Instinct | 첫 실행에서 확인: 제공되면 원격 MCP, 아니면 지침과 웹 이어가기 | 아직 실행되지 않음 | 아직 실행되지 않음 |

해결되지 않은 클라이언트는 [구현 계획](06_implementation_plan.md#phase-5--agent-access)이 말하듯 각주가 아니라 릴리스 차단 요인입니다.

## 실행에서 점검하는 것

- 에이전트가 일반 URL에서 지침을 찾습니다. 찾지 못하면 명시적 `/SKILL.md` 형태로 다시 실행하고 그 사실을 기록합니다.
- 연결하면 클라이언트 이름과 리디렉션 호스트가 표시된 동의 페이지가 나타나며, **Deny**를 누르면 아무것도 연결되지 않습니다.
- 호스트 역할: 에이전트는 설정과 요청을 읽고, 다른 호스트의 요청은 볼 수 없으며, 결정이 필요하면 승인하는 대신 호스트에게 `/app` 검토 링크를 건넵니다.
- 요청자 역할: 에이전트는 사람 본인의 정보로 요청 하나를 만들고, 빠진 것이 있으면 묻고, 사람이 허용한 범위 안에서 선택하고, 사람이 받아들인 시간에만 동의하며, 호스트가 승인하고 서비스가 예약됨으로 표시한 뒤에만 회의가 예약되었다고 보고합니다.
- **Connected agents**에서 연결을 철회하면 에이전트는 다음 호출에서 멈춥니다.
