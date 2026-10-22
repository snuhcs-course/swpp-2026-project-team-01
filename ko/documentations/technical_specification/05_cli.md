> 한국어 번역본 (검토용). 원본: documentations/technical_specification/05_cli.md

# CLI 방향

상태: 정지와 복원을 위한 관리자 CLI 구현됨; 사용자 CLI `fmat`는 `agent-access` 변경에서 결정됨

날짜: 2026-10-19

사용자 CLI는 `fmat`이며, [`agent-access` 변경](../../openspec/changes/agent-access/design.md#9-user-cli)에서 결정했고 아래 [사용자 CLI](#user-cli)에 설명합니다. 관리자 CLI는 그 뒤에 설명합니다.

## 권한 분리

| 인터페이스 | 대상 | 필요한 기능과 권한 |
|---|---|---|
| 사용자 CLI | 호스트, 요청자, 승인된 개인 에이전트 | 공유 도메인 연산을 통한, 역할 범위의 온보딩/설정, 요청 탐색/접수/이어가기, 가용 시간, 협상, 상태 |
| 관리자 CLI | 승인된 팀 운영자 | 별도의 운영자 권한을 통한, 환경에 묶인 호스트 정지 및 복구, 비공개 진단, 허용된 감사(audited) 복구 |

관리자 CLI는 별도의 진입점이자 인증 경계이며, 사용자 CLI의 상승된 모드가 아닙니다. 사용자 자격 증명은 서비스나 데이터베이스 접근 권한을 절대 부여하지 않습니다. [설계 원칙](../03_design_principles.md#3-provide-separate-user-and-administrator-clis)을 따릅니다.

## 사용자 연결과 동작

보호된 호스트 접근은 명시적 동의, PKCE, 현재 범위(scope) 확인, 갱신(refresh), 폐기(revocation)를 갖춘 리소스 결합형(resource-bound) OAuth를 사용합니다. 요청자의 시작과 이어가기는 계정 없이 이루어지며, 허용된 하나의 요청으로 제한됩니다. 공개 스킬 탐색은 자격 증명을 부여하지 않습니다. 공급자/캘린더 토큰은 서비스가 보관합니다.

CLI와 MCP는 별도의 일정 상태 없이 동일한 도메인 의미 체계를 제공합니다. 구조화된 출력은 연산/리소스, 해당하는 경우 리비전/제안, 상태, 오류, 다음 조치를 식별합니다. 현재 시점의 사람 승인은 여전히 필요하며, 귀속 가능한(attributable) 확인을 성립시킬 수 없으면 보호된 검토 화면을 반환합니다. 정확히 같은 재시도에서는 변경(mutation) 식별자를 고정하고, 유실된 토큰 교환/갱신 응답에는 명시적인 재인가 경로를 제공합니다.

## 사용자 CLI

[`agent-access` 제안](../../openspec/changes/agent-access/proposal.md#decisions)(D4, D14)에서 2026-10-22에 결정했습니다. 패키지는 `cli/`의 `@findmeatime/cli`이고 명령은 `fmat`이며, Node.js 20 이상이 필요하고 의존성이 없습니다. npm 배포는 사용자가 결정할 때까지 보류하며, 그때까지는 체크아웃에서 `npm run fmat -- <command>`로 실행합니다. MCP 엔드포인트의 클라이언트이므로 모든 명령이 웹과 동일한 도메인 연산에 도달하고 일정 상태를 보관하지 않습니다.

| 명령 | 효과 |
|---|---|
| `login --host` 또는 `login --handle <handle>` | 사람이 브라우저에서 허용한 뒤, first-party 클라이언트 `fmat-cli`로 호스트 리소스 또는 한 호스트의 요청자 리소스에 연결합니다. `--no-browser`는 URL을 출력하고 `/connect/code`에 표시된 코드를 읽습니다 |
| `status` | 저장된 연결의 오리진, 리소스, 권한, 만료를 보여 주며 토큰은 절대 출력하지 않습니다 |
| `tools` | 연결의 권한이 허용하는 도구를 보여 줍니다 |
| `call <tool> [--input <json>] [--input-file <path>] [--retry-key <key>]` | 도구 하나를 호출합니다. `--retry-key` 없는 변경(mutation)은 새 키를 받으며, 출력에 그 키를 표시하므로 정확히 같은 호출을 반복할 수 있습니다 |
| `logout` | 연결을 폐기하고 저장된 자격 증명을 삭제합니다 |

모든 명령은 stdout에 `ok`와 `result` 또는 `error`(`category`, `message`, `nextAction`)를 담은 JSON 객체 하나를 출력합니다. 종료 코드: 0 성공, 1 도구 오류, 2 사용법 오류, 3 인가 필요, 4 결과 불명(출력된 재시도 키로 반복), 5 서비스 또는 프로토콜 오류. 토큰 갱신이 유실되거나 거부되면 저장된 자격 증명을 삭제하고 `fmat login`을 다시 요청합니다. 자격 증명은 macOS 키체인 또는 Linux Secret Service에 저장하며, 그 외 환경에서는 `--credential-store file`만 `0600` 파일을 씁니다. `FMAT_ORIGIN`은 CLI가 `http://localhost:3000` 같은 다른 오리진을 가리키게 합니다. Windows는 테스트하지 않았습니다.

로그인 취소, 잘못된 리소스, 만료, 폐기된 권한, 다른 사람의 요청, 오래된 제안, 유실된 응답을 테스트합니다. 이전의 `npm run` 명령을 안내하지 않습니다.

관리자의 정지 및 복구 명령은 호스트 계정과 함께 제공하여, 운영자가 최초의 공개 로그인 시점부터 악용을 통제할 수 있게 합니다.

## 관리자 CLI

2026-10-19에 [`host-onboarding` 설계](../../openspec/changes/host-onboarding/design.md#14-administrator-cli)에서 결정했습니다. CLI는 `scripts/admin.ts`이며 이름은 `fmat-admin`이고, 체크아웃에서 `npm run admin -- <command>`로 실행합니다. 패키지로 배포하지 않습니다.

| 명령 | 효과 |
|---|---|
| `show --host <handle-or-id>` | 계정의 상태, 핸들, 준비도를 출력합니다 |
| `suspend --host <handle-or-id> --reason <text>` | 호스팅과 공개 프로필을 정지합니다. 저장된 설정은 유지됩니다 |
| `restore --host <handle-or-id> --reason <text>` | 계정을 복원합니다. 설정이 완료되어 있으면 공개 프로필이 돌아옵니다 |

모든 명령은 `--operator <name>`과 정확히 하나의 환경을 받습니다.

- `--local`은 `DATABASE_URL`을 사용하며 로컬 스택 외의 호스트는 거부합니다.
- `--project <ref>`는 운영자 본인의 `SUPABASE_ACCESS_TOKEN`으로 Supabase Management API를 사용하므로, 운영자 권한은 해당 프로젝트를 소유한 Supabase 조직의 구성원 자격입니다.

변경 작업은 대상을 출력하고 `--yes` 또는 직접 입력한 확인이 필요합니다. 각 작업은 상태 변경과 함께 운영자, 동작, 호스트, 사유, 환경, 시각을 기록합니다. 어떤 호스트, 요청자, 에이전트 자격 증명도 이 경로에 닿지 않습니다. 사용자/MCP 기능의 완전한 동등성과 별도의 운영자 진단/복구는 이후 변경에서 제공합니다. 이를 닫는 증거는 [PRD 수용 시나리오](../02_product_requirements.md#9-end-to-end-release-acceptance-scenarios)가 담당합니다.
