# request-link-management Specification

## Purpose

소유자가 생성한 미팅 요청 링크를 이름으로 구분하고, 공개한 시간과 요청자를 확인하며, 기존 요청을 보존하면서 링크의 공개 상태를 관리할 수 있도록 한다.

## Requirements

### Requirement: Named links with recorded availability
시스템은 소유자가 1–80자의 이름을 입력해 링크를 생성하도록 SHALL 해야 한다. 새 링크는 selected-slot-links 사양에 따라 최신 소유자 캘린더의 추천 후보 중 호스트가 선택한 정확한 시간과 고정 길이를 저장 SHALL 해야 한다. 후보는 저장한 구간 안에서 최신 양쪽 캘린더와 장소 조건을 재검사하여 계산 SHALL 해야 한다.

#### Scenario: Create a link
- **WHEN** 소유자가 유효한 이름으로 링크를 만든다
- **THEN** 링크와 공개 시간대가 저장되고 소유자는 주소를 복사할 수 있다
- **AND** 이름이 없거나 공개 가능한 시간이 없으면 이유를 알려준다

### Requirement: Owner-only details
시스템은 링크 선택 시 이름, 생성일, 공개 상태, 공개 시간대와 해당 링크로 제출된 요청자의 이름·이메일·목적을 소유자에게 표시 SHALL 해야 한다. 다른 소유자나 요청자는 관리 정보에 접근하지 SHALL 못해야 한다.

#### Scenario: Select an existing link
- **WHEN** 소유자가 기존 링크를 클릭한다
- **THEN** 공개한 시간과 그 링크로 들어온 요청을 확인할 수 있다
- **AND** 기간이 없는 최초 버전 링크는 현재 조건을 적용하고, 저장된 공개 구간이 있는 이전 버전 링크는 그 구간을 유지한다. 암호화 주소가 없는 링크는 복사 불가 안내를 제공한다

### Requirement: Close, reopen and delete
시스템은 기간이 남은 링크를 닫거나 다시 열 수 있도록 SHALL 해야 한다. 삭제된 링크와 해당 링크의 요청은 요청 링크 목록 및 받은 요청 목록에서 숨기고 새 요청을 차단하되 기존 기록은 DB에 보존 SHALL 해야 한다. 받은 요청 영역의 제목은 “받은 요청”으로 표시 SHALL 해야 한다. 상태 확인은 공개 화면, 요청자 연결, 요청 저장에 적용 SHALL 해야 한다.

#### Scenario: Closed link receives a submission
- **WHEN** 닫히거나 삭제되거나 만료된 링크에 새 요청이 제출된다
- **THEN** 요청이 저장되지 않고 사용할 수 없는 링크임을 안내한다

#### Scenario: Owner deletes a link
- **WHEN** 소유자가 삭제 안내를 확인하고 삭제한다
- **THEN** 해당 링크로 새 요청을 받을 수 없으며, 목록을 다시 조회해 삭제된 링크와 그 요청을 화면에서 제외한다
- **AND** 등록 중(confirming)인 요청이 있으면 결과 확인을 먼저 요구해 복구 경로를 유지한다

#### Scenario: Paused link retains received requests
- **WHEN** 소유자가 링크를 삭제하지 않고 일시적으로 닫는다
- **THEN** 그 링크로 이미 받은 요청은 받은 요청 목록에 계속 표시된다

### Requirement: Received requests use the current link name
시스템은 받은 요청의 각 링크 묶음 제목에 해당 링크의 현재 이름과 생성일을 표시 SHALL 해야 한다. 요청이 없는 링크에도 같은 이름을 표시 SHALL 해야 한다. 이름 변경 후 받은 요청 메뉴를 선택하거나 페이지를 새로고침하거나 다른 창·탭에서 돌아오면 최신 이름을 다시 조회해 표시 SHALL 해야 한다. 링크 변경 완료 후 목록 갱신 시에도 최신 이름을 표시 SHALL 해야 한다. 이전 조회가 늦게 완료되어 최신 이름을 되돌리지 SHALL 않아야 한다. 이름이 없는 기존 데이터에는 “미팅 요청”을 표시 SHALL 해야 한다.

#### Scenario: Named link has no requests
- **WHEN** 소유자가 이름을 입력해 만든 링크에 아직 요청이 없다
- **THEN** 받은 요청에 “링크 이름 · 생성일”과 “아직 들어온 요청이 없습니다.”가 표시된다

#### Scenario: Link name changes
- **WHEN** 링크 이름이 변경된 뒤 소유자가 받은 요청 메뉴를 선택하거나 페이지를 새로고침하거나 다른 창·탭에서 돌아온다
- **THEN** 기존 요청을 포함한 해당 링크 묶음에 변경된 최신 이름이 표시된다
- **AND** 이전 조회 응답이 늦게 도착하더라도 최신 조회 결과를 덮어쓰지 않는다

#### Scenario: Legacy link has no name
- **WHEN** 기존 링크의 이름이 없거나 공백뿐이다
- **THEN** 빈 제목 대신 “미팅 요청”을 표시한다
