## MODIFIED Requirements

### Requirement: Explicit owner approval
시스템은 소유자의 쓰기 권한과 요청 소유권을 확인하고 후보 중 하나를 선택해 수락하도록 SHALL 해야 한다. 생성 전에 자동 요청은 양쪽 최신 캘린더, 수동 요청은 호스트 최신 캘린더의 충돌과 이동 여유를 재확인 SHALL 해야 한다. 수동 요청은 요청자 캘린더와 입력한 이메일의 소유 여부를 확인하지 못했음을 표시 SHALL 해야 한다.

#### Scenario: Approve a request
- **WHEN** 호스트가 후보 하나를 선택하고 수락 및 초대 발송을 누른다
- **THEN** 선택된 시간으로 본인 기본 캘린더에 일정이 생성되고 저장된 요청자 이메일이 참석자로 포함된다
- **AND** Google에 sendUpdates=all로 초대 알림 발송을 요청한다

#### Scenario: Existing read-only connection
- **WHEN** 쓰기 권한이 없는 호스트가 요청을 수락하려 한다
- **THEN** 일정 등록 권한을 연결하는 안내가 표시되고 동의 전에는 일정을 만들지 않는다

### Requirement: Idempotent approval and recovery
시스템은 중복 클릭과 결과 불명확 재시도에서 같은 요청의 일정/초대를 중복 생성하지 않도록 SHALL 해야 한다. 확정된 요청은 확정 시각과 캘린더 링크를 표시 SHALL 해야 한다.

#### Scenario: Retry after event creation
- **WHEN** Google 등록은 성공했으나 DB 저장이나 응답이 실패한 뒤 재시도한다
- **THEN** 요청별 이벤트 ID로 기존 등록을 확인하고 같은 일정으로 상태를 복구한다

#### Scenario: New calendar conflict
- **WHEN** 수락할 시간에 자동 요청의 양쪽 캘린더 중 하나 또는 수동 요청의 호스트 캘린더에 새 충돌이 생겼다
- **THEN** 일정 생성과 초대 발송을 하지 않고 다른 후보를 선택하도록 안내한다

#### Scenario: Event changed outside Caltalk
- **WHEN** 등록 결과 복구 중 Google 이벤트가 외부에서 변경되거나 삭제된 사실을 발견한다
- **THEN** calendar_conflict 상태를 표시하고 자동 재생성하지 않으며 다른 요청의 처리를 막지 않는다

#### Scenario: Concurrent approvals
- **WHEN** 같은 소유자가 여러 수락을 동시에 시도한다
- **THEN** 소유자별로 하나의 confirming 요청만 허용하고 임대 및 시도 식별자로 중복 실행을 제어한다
