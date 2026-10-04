# Spec Delta

## Purpose

일정 소유자가 로그인 직후 실제 Google Calendar 일정과 미팅 가능한 시간을 한 화면에서 이해하고, 시간 계산에 적용된 조건을 확인할 수 있도록 한다.

## ADDED Requirements

### Requirement: Owner calendar visualization
시스템은 로그인한 소유자의 기본 Google Calendar 일정을 주간 시간표에 표시 SHALL 해야 한다. 종일 일정, 겹치는 일정, 시간대와 날짜를 구분 SHALL 해야 한다. 제목과 장소는 해당 소유자에게만 표시하며 DB에 저장하지 SHALL 않아야 한다.

#### Scenario: Owner opens home
- **WHEN** 소유자가 로그인해 홈을 연다
- **THEN** 실제 일정, 종일 일정, 서울 기준 날짜 및 미팅 가능 시간이 표시된다
- **AND** 캘린더 읽기 실패 시 재시도 또는 재연결 안내가 표시된다

### Requirement: Availability explanation
시스템은 내일부터 14일, 평일 09:00–20:00에서 바쁜 일정 전후 15분을 제외한 30분 이상 빈 구간을 구분해서 표시 SHALL 해야 한다. Google의 한가함 일정은 빈 시간 계산에서 제외 SHALL 해야 한다. 현재 규칙과 공휴일 별도 제외 없음, AI 미연결 상태를 설명 SHALL 해야 한다.

#### Scenario: User checks conditions
- **WHEN** 사용자가 미팅 조건을 본다
- **THEN** 기간·요일·시간·시간대·이동 여유와 현재 변경 불가 여부를 확인할 수 있다
- **AND** 상대방 일정과 장소에 따라 실제 후보가 달라질 수 있음을 확인한다

#### Scenario: Availability block is displayed
- **WHEN** 가능 시간 블록이 표시된다
- **THEN** 해당 구간을 읽을 수 있으며 수정·삭제 기능은 제공되지 않는다
