# manual-meeting-requests Specification

## Purpose

캘린더 연결이나 회원가입을 원하지 않는 미팅 요청자가 호스트가 공개한 시간 중 직접 후보를 선택하도록 한다. 요청자 일정 미확인 상태와 호스트 승인 후 확정되는 흐름을 명확하게 안내한다.

## Requirements

### Requirement: Optional manual selection
시스템은 요청 링크에 기존 Google Calendar 자동 확인과 연동 없이 시간 선택 버튼을 함께 제공 SHALL 해야 한다. 수동 요청에는 Caltalk 가입 또는 Google 동의를 요구하지 SHALL 않아야 한다. 유효한 링크의 공개된 후보 중 현재 호스트 일정·장소 여유와 맞는 시간만 표시 SHALL 해야 한다.

#### Scenario: Guest chooses meeting times
- **WHEN** 요청자가 수동 방식을 선택하고 이름·이메일·목적과 가능한 시간 1–3개를 제출한다
- **THEN** 최신 호스트 일정과 공개 범위·고정 길이를 서버에서 검증하여 검토 대기 요청을 저장한다
- **AND** 요청자의 캘린더를 확인하지 않았으며 호스트 승인 전에는 확정되지 않았음을 안내한다

#### Scenario: Link or calendar changes
- **WHEN** 선택한 시간이 지났거나 일정이 추가되거나 링크가 닫히거나 삭제된다
- **THEN** 수동 제출을 거부하고 다시 조회하거나 새 링크를 요청하도록 안내한다

### Requirement: Manual approval has explicit limits
시스템은 수동 요청을 호스트에게 캘린더·이메일 소유 여부 미확인 상태로 표시 SHALL 해야 한다. 수락 시 최신 호스트 캘린더만 검사하고 기존 중복 방지와 Google 초대 흐름을 사용 SHALL 해야 한다.

#### Scenario: Host approves a manual request
- **WHEN** 호스트가 수동 후보 하나를 명시적으로 수락한다
- **THEN** 호스트 일정과 충돌하지 않으면 Google 일정을 만들고 입력된 요청자 이메일로 초대 알림을 요청한다
- **AND** 존재하지 않는 요청자 캘린더 연결을 읽으려 하지 않는다
