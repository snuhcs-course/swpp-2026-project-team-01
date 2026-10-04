# 저장소 이식 노트: SQLite → Postgres (Supabase)

이 폴더의 설계 문서는 SQLite 기준으로 쓰였다. 팀 리포의 스택(Supabase Postgres + Drizzle pg)에 맞추기 위해 구현은 Postgres로 이식했고, 설계의 **계약(API·상태·불변식)은 그대로**다. SQLite 전제로 쓰인 문장은 아래 대응으로 읽는다.

| 설계 문서의 SQLite 전제 | Postgres 구현 |
|---|---|
| 스키마·마이그레이션 직접 관리(`migrateDatabase`) | `supabase/schemas/scheduler.sql`(선언형) + `supabase/migrations/*_availability_onboarding.sql`(생성). 테스트도 같은 migrations를 PGlite에 적용 |
| 단일 writer(`BEGIN IMMEDIATE`, WAL, `busy_timeout`) | 트랜잭션 + `pg_advisory_xact_lock`(사용자·연결·프로필 단위, 정렬된 순서로 획득) + `SELECT … FOR UPDATE` |
| 동기 API(`db.prepare().get()`) | 전부 async. `Db`는 Drizzle PgDatabase이자 트랜잭션 타입이며, 트랜잭션 안에서는 반드시 `tx`를 넘겨 읽는다 |
| 에포크 ms를 INTEGER로 저장 | `bigint`. postgres-js가 문자열로 돌려주므로 클라이언트에서 Number로 파싱 |
| 모드 바인딩(`storage_settings`) | 동일. `bindDatabaseMode`가 트랜잭션 + advisory lock으로 한 번만 바인딩 |
| 서버 외 접근 없음 | 모든 테이블 RLS 활성화 + anon/authenticated 권한 회수. 앱 서버만 `DATABASE_URL`로 접근 |
| `julianday()` 시간 비교 | `::timestamptz` 캐스트 |
| `INSERT OR IGNORE` | `ON CONFLICT DO NOTHING` |

## 검증 범위
- PGlite 기반 서버 테스트 전체 통과(`npm test`).
- 단일 연결인 PGlite는 경쟁을 재현하지 못하므로, 로컬 Supabase에서 연결 두 개로 같은 요청을 동시에 수락하는 경쟁을 따로 확인했다: 한쪽만 성공, 다른 쪽은 `revision_conflict`, 이벤트는 정확히 2건.
- Supabase transaction pooler(6543)는 prepared statement를 지원하지 않아 `prepare: false`로 연결한다.
