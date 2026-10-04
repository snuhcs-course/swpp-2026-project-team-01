# selected-slot-links Specification

## Purpose
호스트가 공개할 날짜·요일·시간과 미팅 길이를 정하고 직접 선택한 후보만 링크로 공유하여 공개 범위와 미팅 조건을 통제하도록 한다.

## Requirements
### Requirement: Host selects offered slots
시스템은 내일부터 14일의 평일 09:00–20:00 안에서 공개 날짜·요일·일중 시간을 좁히고 미팅 길이(30/45/60/90/120/180/240분)를 정하게 SHALL 해야 한다. 최신 소유자 캘린더에 가능한 서로 겹치지 않는 후보를 최대 5개 제시하고 그 중 2개 이상 선택해야 링크를 만들도록 SHALL 해야 한다.

#### Scenario: Generate and select candidates
- **WHEN** 호스트가 공개 범위와 길이를 입력한다
- **THEN** 해당 길이 전체가 범위와 캘린더 빈 시간에 들어가는 후보가 표시된다
- **AND** 2개 미만을 선택하거나 가능한 후보가 2개 미만이면 링크를 만들 수 없다

### Requirement: Honor selected slots and duration
시스템은 새 링크의 길이를 호스트가 정한 값으로 고정 SHALL 해야 한다. 요청 후보는 호스트가 선택한 정확한 구간 중 최신 양쪽 캘린더와 장소 조건을 만족하는 구간만 사용 SHALL 해야 한다.

#### Scenario: Requester submits through a selected-slot link
- **WHEN** 요청자가 링크로 미팅을 요청한다
- **THEN** 호스트가 정한 길이가 표시되며 변경할 수 없다
- **AND** 선택하지 않은 시간은 추천되지 않는다

### Requirement: Weekly visualization
시스템은 링크 상세의 공개 시간을 작은 주간 시간표로 표시 SHALL 해야 한다.

#### Scenario: View a link across weeks
- **WHEN** 사용자가 링크 상세를 연다
- **THEN** 공개한 시간 블록을 주별로 확인할 수 있고 날짜·시간·길이를 읽을 수 있다

### Requirement: Validate candidate preview
시스템은 후보 미리보기를 소유자와 공개 조건에 묶어 서명하고 15분 동안만 유효하게 SHALL 해야 한다. 링크 생성 시 선택한 2–5개가 서명된 후보에 속하는지와 최신 소유자 캘린더 충돌 여부를 다시 확인 SHALL 해야 한다.

#### Scenario: Calendar changes before link creation
- **WHEN** 후보를 고른 뒤 새 일정이 추가되어 선택한 시간과 충돌한다
- **THEN** 링크 생성을 거부하고 후보 재조회를 안내한다

#### Scenario: Fewer than five candidates
- **WHEN** 조건에 맞는 후보가 5개 미만이다
- **THEN** 실제 개수를 알리고 2개 이상일 때만 링크 생성을 허용한다
