# AI usage records

task(= branch)별로 Claude Code와 Codex가 쓴 토큰과 에이전트가 일한 시간(agent time)을 자동으로 기록하는 도구입니다. 수업에서 task마다 token usage를 내야 해서 만들었습니다.

각자 로컬에 남는 에이전트 로그를 읽어 branch별로 집계하고, 결과를 이 디렉터리에 커밋합니다. 그래서 누가 어떤 도구를 어느 환경에서 쓰든 같은 형식으로 모입니다.

- 지원: Claude Code (CLI, 데스크톱 앱), Codex (CLI, 데스크톱 앱). subagent 사용량도 포함됩니다.
- 저장하는 것: 세션별·모델별 토큰 수, 세션별 agent time, 사용 시각뿐입니다. 프롬프트와 응답은 저장하지 않습니다.

## 설정 (clone마다 한 번)

```bash
git config core.hooksPath .githooks
```

- Node.js가 `PATH`에 있어야 합니다. 의존성 설치는 없습니다.
- `git config user.email`이 설정돼 있어야 합니다. 기록 파일 이름으로 쓰입니다.
- **task용 branch나 worktree를 만들기 전에** 설정하세요. 설정 전에 만들었다가 지운 worktree의 사용량은 복구할 수 없습니다.
- 이 도구가 들어오기 전에 만든 branch에는 main을 merge(또는 rebase)해 오세요. hook은 각 worktree에 체크아웃된 `.githooks/`에서 실행되므로, 그 파일이 없는 branch에서는 오류 없이 아무것도 기록되지 않습니다.

## 사용법

### 평소 작업

```bash
git switch -c feat/my-task        # 또는: git worktree add -b feat/my-task ../my-task
# repo(또는 그 worktree) 안에서 Claude Code / Codex로 작업
git commit ...                    # 커밋할 때마다 자동으로 기록됨
```

커밋할 때마다 `ai-usage/<branch>/<email>.json`이 갱신되고 같은 커밋에 포함됩니다.

**새 작업은 새 branch에서 세션을 시작하세요.** 사용량은 세션이 실행된 폴더에 그때 체크아웃돼 있던 branch로 들어갑니다. 그래서 다른 task의 branch(또는 그 worktree)에서 세션을 열고 새 작업을 하면, 그 사용량이 기존 task에 섞입니다. 자동으로는 구분할 수 없습니다. 병렬로 여러 작업을 한다면 작업마다 `git worktree add -b feat/new ../new`로 branch와 폴더를 먼저 만들고, 그 폴더에서 바로 세션을 시작하세요.

마지막 커밋 뒤에 쓴 토큰은 다음 커밋에 반영됩니다. 리뷰를 요청하기 전에 에이전트를 더 썼다면 한 번 더 기록하세요.

```bash
node scripts/ai-usage.mjs record --stage
git commit -m "chore: record AI usage"
```

### 결과 보기

```bash
node scripts/ai-usage.mjs report            # 현재 branch
node scripts/ai-usage.mjs report feat/x     # 다른 branch
```

출력 예시:

```text
### AI usage: `feat/my-task`

Contributors: a@example.com, b@example.com · Sessions: 3

Agent time: **1h 42m** (claude-code 1h 30m, codex 0h 12m)

| Agent | Model | Input | Cache read | Cache write | Output (reasoning) | Total | API-equiv. USD |
|---|---|--:|--:|--:|--:|--:|--:|
| claude-code | claude-opus-5-5 | 60 | 4,542,201 | 55,466 | 38,321 (0) | 4,636,048 | $2.12 |
| codex | gpt-5.6-sol | 250 | 50 | 0 | 30 (5) | 330 | $0.00 |
| **Total** | | ... | ... | ... | ... | ... | **$2.12** |
```

PR을 열면 `AI usage` workflow가 이 표를 PR 댓글로 달고, push할 때마다 같은 댓글을 갱신합니다. 기록이 없어도 CI는 실패하지 않습니다.

### 열 설명

| 열 | 의미 |
|---|---|
| Input | 캐시되지 않은 입력 토큰 |
| Cache read | 캐시에서 읽은 입력 토큰 |
| Cache write | 캐시에 쓴 입력 토큰 |
| Output (reasoning) | 출력 토큰. 괄호 안은 그중 reasoning 토큰 |
| Total | Input + Cache read + Cache write + Output |
| API-equiv. USD | 같은 양을 API 정가로 썼다면 들었을 비용. 구독 요금제에서 실제로 청구된 금액이 아닙니다. 가격표에 없는 모델은 `n/a`로 표시합니다 |

**Agent time**은 에이전트가 요청 하나를 받아 응답을 끝낼 때까지 걸린 시간(turn 시간)의 합입니다. 사용자가 다음 요청을 쓰는 동안처럼 에이전트가 기다린 시간은 들어가지 않습니다.

- 동시에 돌아간 세션은 더합니다. 두 세션이 1시간씩 동시에 일했다면 2시간입니다(man-hour 개념).
- subagent 시간은 부모 turn 안에 이미 포함되므로 따로 더하지 않습니다.
- 출처는 Claude Code 로그의 `turn_duration`, Codex 로그의 `task_complete`(중단된 turn은 `turn_aborted`)입니다.

Claude와 Codex(OpenAI)는 토큰을 세는 방식이 다릅니다. OpenAI는 cached 토큰을 input에 포함해서 셉니다. 여기서는 모든 도구의 값을 서로 겹치지 않는 열로 나눠 두었기 때문에, 열을 더하면 Total이 됩니다.

## 집계 기준

각 API 호출(Claude) 또는 turn(Codex)의 토큰과 각 turn의 agent time을 **그 시점에 그 작업 폴더에 체크아웃돼 있던 branch** 하나에 넣습니다. 세션의 누적값을 쓰지 않으므로 같은 토큰이나 시간이 두 번 세어지지 않습니다. 아래 규칙은 토큰과 시간에 똑같이 적용됩니다.

| 상황 | 처리 |
|---|---|
| repo 또는 그 worktree 안(하위 폴더 포함)에서 연 세션 | 그 시점의 branch로 집계 |
| main이나 detached 상태에서 시작해, 같은 세션에서 새 branch로 이동 | 앞부분도 새 branch로 집계 |
| 끝까지 main에만 있던 세션 | main 몫으로 남음 |
| 끝까지 detached였던 세션 | 집계하지 않고 커밋할 때 경고 출력 |
| `git branch -m`으로 이름 변경 | 옛 이름의 기록이 새 이름으로 합쳐짐 |
| 작업 후 worktree 삭제 | 그대로 집계됨 (`.git/ai-usage-branches.log`에 branch 변경 기록이 남음) |
| 여러 머신에서 같은 branch 작업 | 세션 단위로 합쳐짐. 머신마다 커밋하면 됩니다 |
| 같은 사람이 여러 Claude 계정 사용 (`~/.claude2` 등) | `~/.claude*`를 모두 읽음 |

## 기록되지 않는 경우

- **repo 밖에서 연 세션.** 예를 들어 상위 폴더에서 에이전트를 열고 repo 파일을 고친 경우입니다. 어느 repo 작업인지 알 수 없어서 빠집니다. 에이전트는 반드시 repo 폴더 안에서 여세요.
- **별도 clone이나 다른 repo에서 한 작업.**
- **클라우드 세션**: Claude Code on the web, Codex cloud. 로컬에 로그가 남지 않습니다.
- **로컬 로그가 지워진 경우.** Claude Code는 오래된 로그를 자동으로 지웁니다(`cleanupPeriodDays`). 한 번 커밋된 기록은 로그가 지워진 뒤에도 유지됩니다.

## 파일 구성

| 경로 | 역할 |
|---|---|
| `scripts/ai-usage.mjs` | 집계(`record`)와 출력(`report`) |
| `.githooks/pre-commit` | 커밋할 때 `record --stage` 실행. 실패해도 커밋을 막지 않습니다 |
| `.githooks/post-checkout` | branch를 바꾸거나 worktree를 만들 때 `.git/ai-usage-branches.log`에 기록 |
| `.github/workflows/ai-usage.yml` | PR에 집계 표를 댓글로 게시 |
| `ai-usage/<branch>/<email>.json` | 기록 파일. 직접 수정하지 마세요. 다음 커밋 때 다시 계산됩니다 |

API 가격표는 `scripts/ai-usage.mjs` 위쪽의 `PRICES`에 있습니다. 출처 링크와 확인 날짜가 함께 적혀 있습니다. 새 모델을 쓰거나 가격이 바뀌면 그 부분만 고치면 됩니다. 기록 파일에는 토큰 수만 저장되므로, 다시 기록하지 않아도 `report`에 바로 반영됩니다.

## 문제 해결

- **커밋했는데 기록 파일이 안 생겨요**
  - `git config core.hooksPath`가 `.githooks`인지 확인하세요.
  - 커밋 출력에 `ai-usage:`로 시작하는 메시지가 있는지 보세요.
  - 그 branch에 해당하는 사용량이 없으면 파일을 만들지 않습니다.
- **`ai-usage: ... tokens and ... of agent time on a detached HEAD could not be assigned to a branch`**: detached 상태에서 쓰고 끝내 branch로 이어지지 않은 사용량입니다. 대개 Codex 앱의 worktree에서 branch를 만들지 않은 경우입니다.
- **숫자가 예상보다 작아요**: 에이전트를 repo 밖에서 열지 않았는지 먼저 확인하세요.
