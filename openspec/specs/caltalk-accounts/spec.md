# caltalk-accounts Specification

## Purpose

Caltalk 이메일 계정과 Google Calendar 연결을 분리하여, 한 번 확인한 Google 연결과 기존 링크 기록을 이후 로그인에서도 재사용한다. 계정 신원과 연결 소유권은 서버에서 검증한다.

## Requirements

### Requirement: Caltalk account sessions
시스템은 이메일·비밀번호 계정 가입과 로그인, 로그아웃을 제공하고 Supabase Auth로 계정 신원을 확인 SHALL 해야 한다. 로그인 상태는 HttpOnly 쿠키와 세션 갱신으로 유지하고, 비밀번호·서버 키·Google 토큰을 브라우저 응답에 노출하지 SHALL 않아야 한다. 이메일 인증 설정을 유지 SHALL 해야 한다.

#### Scenario: Returning account signs in
- **WHEN** 사용자가 이메일 인증을 마친 Caltalk 계정으로 로그인한다
- **THEN** 저장된 Google 연결이 있으면 Google 동의 화면 없이 캘린더 화면을 연다
- **AND** 연결이 없으면 최초 연결 화면을 제공한다

#### Scenario: Account logs out
- **WHEN** 사용자가 로그아웃한다
- **THEN** 해당 브라우저의 Caltalk 세션과 이전 역할 쿠키를 제거한다
- **AND** 다른 계정 로그인은 이전 계정의 Google 연결을 사용하지 않는다

### Requirement: Verified persistent Google binding
시스템은 OAuth 완료 시 인증한 Caltalk 계정과 Google sub를 원자적으로 연결 SHALL 해야 한다. OAuth 시작 계정과 완료 계정이 달라지거나 다른 계정에 이미 연결된 Google 계정이면 연결을 거부 SHALL 해야 한다. 기존 링크와 요청은 보존 SHALL 해야 한다.

#### Scenario: Existing owner creates a Caltalk account
- **WHEN** 기존 호스트가 Caltalk에 로그인하고 같은 Google 계정으로 연결을 승인한다
- **THEN** 기존 Google 연결과 링크 기록을 자신의 Caltalk 계정에서 사용한다

#### Scenario: Google access expires
- **WHEN** Google이 연결 토큰을 만료 또는 취소하여 조회가 실패한다
- **THEN** 재연결 경로를 제공하며 일반 Caltalk 로그인에 캘린더 권한 동의를 강제하지 않는다
