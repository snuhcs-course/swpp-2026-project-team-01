# Supabase

> 한국어 번역본 (검토용). 원본: supabase/README.md

공유 프로젝트는 **`anelszynxtvxoxqvzgqt`**(**FindMeATime**, `us-east-2`)이며, Supabase CLI **2.119.0**으로 연결되어 있습니다. 링크 메타데이터는 Git에서 무시합니다. 팀원은 개인 프로젝트에서 개발하며, 공유 프로젝트는 CI에서만 마이그레이션을 받습니다. 자세한 내용은 [환경과 협업](../documentations/technical_specification/03_provider_setup.md#environments-and-collaboration)을 참고하십시오. PostgreSQL 17과 Supabase가 관리하는 Auth, Storage, Vault, cron, 큐 인프라로 동작하며, Phase 1 마이그레이션은 2026-10-19에 기록된 예외로서 한 번 수동으로 적용되었습니다. 관찰된 상태와 선행 조건은 [제공자 설정](../documentations/technical_specification/03_provider_setup.md#supabase-project)을 참고하십시오.

로컬 `config.toml`은 PostgreSQL 주 버전 17을 대상으로 하며, pg-delta와 마이그레이션은 활성화되어 있고 시드는 비활성화되어 있습니다. 이 파일의 `project_id`는 일회용 로컬 스택을 식별하며, 호스팅된 프로젝트를 가리키지 않습니다.

원하는 스키마는 `schemas/` 아래에, 검토된 마이그레이션 체인은 `migrations/` 아래에 두며, [에이전트 지침](../AGENTS.md#supabase-schema-changes)을 따릅니다. 기준선은 역할 매트릭스를 선언합니다.

- 애플리케이션 객체는 `postgres`가 소유하고 Data API로 노출되지 않는 비공개 `app` 스키마에 있습니다. 그 안의 모든 테이블은 정책 없이 행 수준 보안을 활성화하므로, 소유자만 읽을 수 있습니다.
- `anon`과 `authenticated`는 `postgres`가 `public`에 만드는 테이블, 시퀀스, 함수에 대해 기본 권한이 없으며, `postgres`가 만든 어떤 함수도 `PUBLIC`이 실행할 수 없습니다. `service_role`은 `public`에서 플랫폼 기본값을 유지합니다.
- 전역 함수 권한 취소는 pg-delta가 전역 기본 권한을 비교하지 않기 때문에 직접 작성한 마이그레이션입니다. `schemas/_custom/default_privileges.sql`이 이를 그대로 반영하여 이후 동기화도 같은 상태를 봅니다.

`tests/`는 pgTAP으로 이 매트릭스를 증명합니다. `supabase start`와 `supabase test db`를 실행하십시오. `.github/workflows/check.yml`의 `database` 작업은 모든 푸시에서 같은 명령을 실행합니다. 미리 설치된 확장을 고려하고, 관리되는 스키마는 절대 편집하지 마십시오. `supabase db push --dry-run`을 검토하고 환경을 명시적으로 식별한 뒤에만 호스팅된 프로젝트에 배포하십시오.
