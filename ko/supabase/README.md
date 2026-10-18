# Supabase

> 한국어 번역본 (검토용). 원본: supabase/README.md

공유 프로젝트는 **`anelszynxtvxoxqvzgqt`**(**FindMeATime**, `us-east-2`)이며, Supabase CLI **2.119.0**으로 연결되어 있습니다. 링크 메타데이터는 Git에서 무시합니다. 팀원은 개인 프로젝트에서 개발하며, 공유 프로젝트는 CI에서만 마이그레이션을 받습니다. 자세한 내용은 [환경과 협업](../documentations/technical_specification/03_provider_setup.md#environments-and-collaboration)을 참고하십시오. 애플리케이션 스키마는 비어 있습니다. PostgreSQL 17을 사용하며, Supabase가 관리하는 Auth, Storage, Vault, cron, 큐 인프라가 있습니다. 애플리케이션 테이블, 함수, 마이그레이션, 예약 작업은 없습니다. 관찰된 상태와 선행 조건은 [제공자 설정](../documentations/technical_specification/03_provider_setup.md#supabase-project)을 참고하십시오.

로컬 `config.toml`은 PostgreSQL 주 버전 17을 대상으로 하며, pg-delta가 활성화되어 있고, 마이그레이션과 시드 실행은 비활성화되어 있습니다. 이 파일의 `project_id`는 일회용 로컬 스택을 식별하며, 호스팅된 프로젝트를 가리키지 않습니다. 이 파일의 Auth 기본값도 호스팅 설정을 내보낸 것이 아닙니다.

첫 스키마 변경은 `schemas/` 아래에 원하는 SQL을 만들고, `migrations/` 아래에 검토된 마이그레이션 체인을 생성하며, 일회용 로컬 데이터베이스에서 이를 검증합니다. 이때 [에이전트 지침](../AGENTS.md#supabase-schema-changes)을 따릅니다. 그 전에 private/exposed 네임스페이스와 역할 매트릭스를 정의하십시오. 현재 `public`에 만들어진 객체는 `anon`, `authenticated`, `service_role`의 테이블, 시퀀스, 함수 권한을 상속합니다. 따라서 기본값에 의존하지 말고 명시적인 권한 부여, 권한 취소, RLS를 선언하십시오. 미리 설치된 확장을 고려하고, 관리되는 스키마는 절대 편집하지 마십시오. `supabase db push --dry-run`을 검토하고 환경을 명시적으로 식별한 뒤에만 호스팅된 프로젝트에 배포하십시오.
