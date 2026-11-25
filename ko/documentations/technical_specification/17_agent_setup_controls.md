> 이 문서는 `documentations/technical_specification/17_agent_setup_controls.md`의 한국어 검토 번역입니다. 영어 원문이 기준입니다.

# 에이전트 설정 제어

상태: [mcp-ux](../../openspec/changes/mcp-ux/proposal.md)의 구현 초안이며 추적 이슈는 [#328](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/328)입니다. PR #342는 제외합니다. 제안 동작의 계약은 capability delta에 있습니다.

## 일시중지와 재개

호스트는 연결된 iMessage, Telegram의 설정 대화나 요청 검토 대화에서 “새 미팅 요청을 당분간 받지 않을게” 또는 “다시 요청 받을게”라고 말할 수 있습니다. Thyme은 접수 revision을 읽고 웹 설정 스위치와 같은 명령으로 저장합니다. 저장된 상태는 설정에도 표시됩니다. 기존 요청과 메신저 연결은 유지됩니다. STOP과 unlink는 기존처럼 연결을 해제합니다.

MCP의 `get_host_status.intake`는 `accepting`과 `revision`을 반환하고, `acceptingRequests`는 접수 선택과 준비 상태를 함께 반영합니다. `set_request_intake({accepting, expectedRevision, retryKey, hostWords})`에는 `host:write`가 필요합니다. 오래된 revision은 거절하고 같은 재시도는 원래 결과를 반환합니다. 접수를 켜도 설정 미완료, Calendar 접근 상실, 계정 정지를 우회할 수 없습니다.

## MCP 변경 확정

`update_setup_field`는 필드를 초안에 기록합니다. 응답에 현재 설정과 `nextStep`을 추가했고 `get_setup.nextStep`도 미확정 변경을 반영합니다. 필수 값이 모두 있으면 에이전트가 설정을 읽어주고 호스트의 동의를 받아 최신 revision과 proposal hash로 `confirm_setup`을 호출합니다. 성공 전까지는 이전 확정 정책으로 시간을 평가합니다.

## 주별 가능 시간

선택적 `scheduleOverrides` 필드는 MCP `update_setup_field`와 메신저의 `draft_settings` 또는 `change_settings`로 수정할 수 있습니다. 기존 객체를 먼저 읽고 관련 없는 항목을 보존한 뒤 대체합니다. 최초 설정 확인과 설정 완료 호스트의 저장 규칙은 그대로 적용됩니다. 웹 설정 모달은 그대로 유지하며 이 초안에서는 메신저와 MCP로 이 고급 규칙을 편집합니다.

```json
{
  "alternateWeeks": {
    "anchorWeek": "2026-11-23",
    "windows": [{"weekday": "monday", "start": "14:00", "end": "18:00"}]
  },
  "weeks": [{"weekStart": "2026-11-30", "windows": []}]
}
```

기준 주와 대체 주는 호스트 시간대의 실제 월요일 날짜입니다. 격주 시간은 기준 주의 앞뒤로 2주마다 적용하며 다른 주는 기본 주간 시간을 씁니다. 날짜로 지정한 규칙이 우선하고 해당 주 전체를 대체합니다. 빈 시간 목록은 휴무입니다. 중복 없는 특정 주 최대 104개와 주당 시간 구간 최대 21개를 허용합니다. 자정을 넘는 시간은 월요일로 이어지는 부분도 시작 날짜의 주에 속합니다. 규칙이 없으면 기존 동작을 유지합니다. 캘린더 충돌, 버퍼, DST 검사도 적용됩니다.

## 가능 시간 미리보기

`preview_next_week`에 선택적 `week: "this_week" | "next_week"`를 추가하며 기본은 호환성을 위해 다음 주입니다. 이번 주는 호스트 시간대로 계산하고 현재 시각부터 보여주며 지난 날짜는 비워둡니다. 이미지와 메시지 모두 요청한 주를 표시합니다. 이번 주 이미지는 참고용이며 최초 설정을 확정할 수 없습니다. 호스트는 여전히 최신 설정의 다음 주 미리보기에 동의해야 합니다.

캘린더를 바꾸면 이미 분석을 다시 실행하며 설정 지침은 제안 시간이 달라졌을 때 한 번 제안하고 호스트가 동의할 때까지 기존 시간을 유지하도록 합니다. 이 초안은 그 규칙을 보존합니다. 출시 전 모델 동작 평가와 실기기 확인이 필요합니다.
