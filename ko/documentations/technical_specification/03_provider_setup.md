> 한국어 번역본 (검토용). 원본: documentations/technical_specification/03_provider_setup.md

# 공급자 설정과 환경 방향

상태: 환경 선정 완료, 공급자 및 런타임 인수 검증 보류

날짜: 2026-10-19

## 배포 origin

정식(canonical) origin은 **`https://findmeatime.com`**이며, **`https://release.findmeatime.com`**도 같은 배포를 독립적으로 제공합니다. 로컬 브라우저 개발은 **`http://localhost:3000`**에서 하는 것을 의도합니다. 제품의 진입 약속은 `https://findmeatime.com/SKILL.md`와 호스트별 스킬 링크로 유지합니다. Phase 2부터 두 origin 모두 `/SKILL.md`, `/{handle}/SKILL.md`, `/llms.txt`를 제공합니다([인수 기록](07_acceptance_record.md#phase-2--host-onboarding)). 호스트 문서가 안내하는 요청자 접수는 Phase 3에서 열리므로, 요청자가 아직 예약할 수 있다고 주장하지 마십시오. 콜백이나 비공개 링크를 만들 때 신뢰할 수 없는 요청 헤더를 절대 사용하지 않습니다.

호스팅 방향은 Vercel입니다. Cloudflare는 계속 `findmeatime.com`의 등록기관이자 권한 있는 DNS입니다. DNS를 변경하기 전에 실제 팀/프로젝트를 확인하고 현재의 도메인 점검(inspect) 출력을 사용하며, [도메인 지침](../../AGENTS.md#domain-and-dns)을 따릅니다. 도메인 소유만으로는 애플리케이션이 사용 가능함을 증명하지 못합니다.

**2026-10-19 배포.** Vercel 프로젝트 **`findmeatime-release`**가 `findmeatime.com`과 `release.findmeatime.com`을 모두 제공하며, 함수는 공유 데이터베이스 옆의 **`cle1`** 리전에서 실행됩니다. 사용자의 요청에 따라 루트 도메인은 [Phase 8 승격](06_implementation_plan.md#phase-8--operations-and-release)보다 앞서 지금 연결되었고, 이전 프로토타입 프로젝트에서 옮겨졌습니다. `dev.findmeatime.com`은 별도의 `findmeatime-dev` 프로젝트에 남아 있습니다. Production에서 `APP_ORIGIN`은 `https://findmeatime.com`, `APP_ALLOWED_ORIGINS`는 `https://release.findmeatime.com`입니다. Production과 Preview 변수는 따로 설정하며, Preview에는 `WORKER_SECRET`이 없고, 환경마다 고유한 `TOKEN_ENCRYPTION_KEY`와 `EVE_INTERNAL_SIGNING_KEY`를 둡니다. `DATABASE_URL`은 공유 프로젝트의 트랜잭션 풀러를 사용합니다. 두 이름의 Cloudflare `A` 레코드는 `vercel domains inspect`가 보고하는 주소를 DNS 전용으로 가리킵니다. 이전 프로토타입이 프로젝트에 남긴 변수는 사용되지 않으며 아직 제거해야 합니다. 실행한 검사는 [인수 기록](07_acceptance_record.md#production-deployment)에 있습니다.

## Supabase 프로젝트

Supabase 프로젝트 **`anelszynxtvxoxqvzgqt`**(**FindMeATime**, 리전 **`us-east-2`**)를 팀의 공유 프로젝트로 사용합니다. 사용 방식은 [환경과 협업](#environments-and-collaboration)을 참고하십시오. Supabase CLI 2.119.0으로 `supabase link --project-ref anelszynxtvxoxqvzgqt`를 실행해 각 클론을 연결하며, 연결 메타데이터는 Git에서 제외됩니다. 애플리케이션과 공급자 자격 증명은 이 프로젝트에 대해 검증되지 않았습니다.

**`mriseqztcwmezvtawnbo`**(**FindMeATime2**, `us-west-1`, PostgreSQL 17.11)는 같은 조직에 존재하며 향후 릴리스 프로젝트로 예약되어 있습니다. 현재는 관련 없는 내용이 들어 있어 사용하기 전에 비워야 하며, 개발용으로 연결하지 않습니다. 샌드박스가 아닙니다. Phase 1은 이 프로젝트를 예약된 채로 건드리지 않았으며, 마이그레이션, 설정 푸시, 배포 모두 하지 않았습니다. 2026-10-23의 읽기 전용 점검([`operations-and-release` 설계 12](../../openspec/changes/operations-and-release/design.md#12-environments))에서 1차 반복의 프로토타입이 아직 남아 있는 것을 확인했습니다. 테이블 103개와 라이브 행 84개가 있는 `fmat` 스키마, `20261011125843`까지의 마이그레이션 기록 143건, Auth 사용자 2명, Vault 비밀 5개, 매분 또는 10분마다 실행되는 `pg_cron` 작업 17개입니다. CLI의 쿼리가 임시 `cli_login_postgres` 역할을 만들었습니다. 프로젝트를 비우는 일은 사용자에게 맡깁니다.

스키마 기준선과 Phase 1 마이그레이션은 2026-10-19에, Phase 2 마이그레이션은 2026-10-20에 적용되었습니다([환경과 협업](#environments-and-collaboration) 참고). 그 전에는 이 프로젝트의 애플리케이션 스키마가 비어 있었습니다. `public`에는 애플리케이션 관계(relation), 함수, 타입이 없었고, 애플리케이션 마이그레이션 기록, 예약된 작업(scheduled job), 등록된 큐도 없습니다. Supabase가 관리하는 Auth, Storage, Realtime, Vault, 네트워크, cron, 큐 인프라는 남아 있으며, Auth 신원, Storage 객체, Vault 시크릿은 없습니다. 2026-10-19에 어느 브랜치에도 속하지 않던 실험 잔여물(애플리케이션 스키마 2개, 역할 2개, 마이그레이션 기록 5개, Vault 시크릿 2개, 테스트 신원 1개)을 제거한 뒤 검증했으며, 첫 마이그레이션 전에 다시 확인하십시오. PostgreSQL은 **17.6**으로 로컬의 메이저 버전과 일치합니다. 설치된 확장은 `pg_cron` 1.6.4, `pg_net` 0.20.4, `pgmq` 1.5.1, `pgcrypto` 1.3, `pg_stat_statements` 1.11, `supabase_vault` 0.3.1, `uuid-ossp` 1.1, `plpgsql` 1.0이며, 이는 전제 조건일 뿐 애플리케이션 큐, 워커, 권한이 존재한다는 증거가 아닙니다.

`postgres` 또는 `supabase_admin`이 `public`에 만든 객체는 현재 테이블/시퀀스 권한과 함수 실행 권한을 `anon`, `authenticated`, `service_role`에 상속합니다. 첫 스키마 배포 전에 네임스페이스와 기본 권한을 검토하고, 의도한 권한 부여(grant), 회수(revoke), RLS를 명시적으로 선언해야 합니다. Google 신원만으로는 호스트 계정, 캘린더 권한 부여, 채널 접근을 성립시키지 않으며, 이것들은 승인된 애플리케이션 작업을 통해서만 생성합니다.

로컬 `config.toml`은 PostgreSQL 메이저 17, pg-delta 활성화, 마이그레이션 활성화, 시드 비활성화, 선언형 `schema_paths` 없음 상태입니다. 그 `project_id`는 로컬 스택 식별자이지 호스팅 프로젝트 ref가 아닙니다. 스키마 기준선은 애플리케이션 객체를 비공개 `app` 스키마에 두고 `public`에서 `anon`과 `authenticated`의 기본 권한을 취소합니다. 역할 매트릭스와 그 pgTAP 테스트는 [`supabase/README.md`](../../supabase/README.md)에 설명되어 있습니다. 모든 스키마 변경에는 [pg-delta 워크플로](../../AGENTS.md#supabase-schema-changes)를 사용합니다. 원하는 스키마를 편집하고, 마이그레이션을 생성해 검토하고, 일회용 로컬 데이터베이스에서 체인을 검증하며, 검토된 드라이 런과 명시적인 환경 식별을 거친 뒤에만 호스팅 프로젝트에 푸시합니다.

## 환경과 협업

2026-10-19에 결정되었습니다. 팀은 **하나의 공유 환경과 개인 샌드박스**로 시작하며, 별도의 릴리스 환경은 아래의 트리거 조건에 따라 나중에 추가합니다. 브랜치 운영은 [GitHub Flow](../../AGENTS.md#git-workflow-and-pull-requests)를 따르며, `main`이 유일한 장기 브랜치입니다.

| 계층 | Supabase | 애플리케이션 런타임 | 변경 주체 |
|---|---|---|---|
| 개인 샌드박스 | 각 팀원이 개인 Supabase 조직에 만든 본인의 무료 프로젝트 | 팀원 컴퓨터의 `eve dev`와 `next dev`. eve는 대화 상태를 로컬 `.eve/.workflow-data` 디렉터리에 보관하며 Docker는 필요하지 않음 | 팀원이 자유롭게 |
| 공유 | **FindMeATime** `anelszynxtvxoxqvzgqt` | `findmeatime.com`과 `release.findmeatime.com`에서 제공되는 `findmeatime-release`의 Vercel **Production** 배포. 풀 리퀘스트는 같은 프로젝트를 대상으로 하는 Vercel **Preview** 배포를 받음 | `main`에 머지될 때 CI가 수행. 사람이 직접 변경하지 않음(아래에 기록된 예외 한 번) |
| 릴리스 | 비운 뒤의 **FindMeATime2** `mriseqztcwmezvtawnbo` | 분리가 이루어진 뒤 `findmeatime.com`과 `release.findmeatime.com`을 서비스하는 `findmeatime-release`의 Vercel **Production**. 그러면 위의 공유 행은 스테이징으로서 `dev.findmeatime.com`의 `findmeatime-dev`로 옮겨집니다(D13) | GitHub 환경 승인 뒤의 `Deploy release Supabase` 워크플로; 병합된 `main` 리비전에서 저장소 소유자가 실행하는 `vercel deploy --prod`. 아직 사용하지 않음 |

스키마 변경은 한 방향으로 흐릅니다.

1. 팀원이 토픽 브랜치에서 `supabase/schemas/` 아래의 원하는 SQL을 편집합니다.
2. pg-delta로 마이그레이션을 생성하려면 섀도 데이터베이스를 위해 Docker가 필요합니다. Docker가 있는 팀원이 같은 풀 리퀘스트에서 마이그레이션을 생성하고 커밋하며, 생성에 전체 `supabase start` 스택은 필요하지 않습니다.
3. 팀원은 `supabase db push`로 브랜치의 마이그레이션을 자신의 샌드박스에 적용하고, 브랜치를 전환하거나 이력이 어긋날 때 `supabase db reset --linked`로 샌드박스를 초기화합니다. 공유 픽스처는 `supabase/seed.sql`에 두어 초기화하면 복원되도록 합니다.
4. 검토와 머지가 끝나면 [`Deploy shared Supabase`](../../.github/workflows/deploy-shared.yml) 워크플로가 `supabase db push --dry-run`을 출력하고, 마이그레이션을 공유 프로젝트에 푸시하며, 두 GitHub 시크릿이 모두 설정되어 있으면 워커 URL과 시크릿을 Vault에 쓰고, `supabase config push`를 실행합니다. 이 푸시는 `supabase/config.toml`이 선언한 모든 설정을 적용하므로, 그 파일의 변경은 호스팅 프로젝트의 변경으로 검토하십시오. 사이트 URL과 리디렉션 허용 목록은 `SUPABASE_AUTH_SITE_URL`과 쉼표로 구분한 `SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS` 변수에서 옵니다. CI에서는 GitHub 저장소 변수이고, 로컬 `supabase start`에서는 루트 `.env`입니다. 워크플로에는 `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `WORKER_URL`, `WORKER_SECRET` 저장소 시크릿이 필요합니다. `WORKER_URL`은 정식 origin의 프로덕션 워커 경로인 `https://findmeatime.com/api/internal/jobs`이고, `WORKER_SECRET`은 Vercel Production의 `WORKER_SECRET`과 같은 값(영문자, 숫자, `_`, `-` 32자 이상)입니다. 삽입 트리거와 매분 실행되는 `pg_cron` 스윕은 그 시크릿으로 그 URL에 요청을 보내며, 모든 샌드박스처럼 Vault 항목 중 하나라도 없으면 아무것도 하지 않습니다.

**첫 푸시, 2026-10-19.** Phase 1 마이그레이션은 풀 리퀘스트가 머지되기 전에, 사용자의 명시적 요청에 따라 Supabase CLI로 한 번 수동으로 공유 프로젝트에 적용되었습니다. 이는 위의 CI 전용 규칙에 대한 예외이며, 프로덕션 배포에 스키마가 필요했기 때문입니다. 상태(애플리케이션 스키마 없음, 원격 마이그레이션 없음)를 읽은 뒤 `supabase db push --linked --dry-run`이 14개 마이그레이션을 나열했고 `supabase db push --linked`가 이를 적용했습니다. `supabase migration list --linked`는 14개 모두를 보여 주며, `supabase db diff --linked`는 애플리케이션 드리프트가 없음을 보여 줍니다(체인이 선언하지 않는, 플랫폼에 미리 설치된 `pgmq` 확장만 나타남). `supabase config push`는 사이트 URL `https://findmeatime.com`과 리디렉션 허용 목록 `https://findmeatime.com/auth/callback`, `https://release.findmeatime.com/auth/callback`, `http://localhost:3000/auth/callback`을 적용했고, 그 뒤 `supabase config diff`는 갱신 항목이 없다고 보고했습니다. Google 공급자는 변경하지 않았습니다. Vault 워커 URL은 Production `WORKER_SECRET`과 함께 `https://findmeatime.com/api/internal/jobs`이며, `app-jobs-sweep` cron 작업은 매분 성공합니다. 공유 데이터베이스 비밀번호는 2026-10-19에 Management API로 재설정되었고 Production과 Preview의 `DATABASE_URL`에만 보관됩니다. Phase 2 마이그레이션 두 개는 2026-10-20에 같은 방식으로, 이번에도 사용자의 승인을 받아 적용되었습니다. `Deploy shared Supabase` 워크플로의 저장소 시크릿과 변수가 아직 설정되지 않았기 때문입니다. 이후의 변경이 워크플로를 거치도록 이와 같은 값으로 설정하십시오.

작업(jobs): 워커 경로는 Production 배포에서만 실행되고 프로덕션에서 만들어진 작업만 가져가므로, 작업 기반 처리는 이 경로를 통해 Preview 배포나 샌드박스에서 실행되지 않습니다. 샌드박스나 로컬 스택에서는 `npm run jobs:dev`가 같은 워커를 `DATABASE_URL`에 대해 실행하며 로컬에서 만들어진 작업만 가져갑니다. 이 명령은 공유 프로젝트와 릴리스 프로젝트의 ref를 거부합니다.

공유 프로젝트의 규칙은 다음과 같습니다. Studio나 SQL 편집기로 스키마를 변경하지 않으며, `supabase db diff --linked`는 커밋된 마이그레이션과 비교해 항상 비어 있어야 합니다. 릴리스 분리 전까지 데이터는 일회용이므로 팀 공지 후에 `supabase db reset --linked`를 실행해도 됩니다. [메시징 환경 계약](../../openspec/specs/messaging-environments/spec.md)이 요구하는 대로 애플리케이션 메시징은 프로덕션 배포 외에서는 거부되므로, Preview 배포는 이메일이나 iMessage를 보낼 수 없습니다.

설정: 공유 프로젝트의 URL과 키는 Git이 아니라 팀의 비밀번호 관리자를 통해 공유하며, `.env.example`에는 변수 이름만 나열합니다. Vercel 환경 변수는 Production과 Preview로 범위를 나눕니다. 로컬에서 로그인이 동작하도록 `http://localhost:3000/**`와 각 팀원의 샌드박스 콜백을 Auth 리디렉션 허용 목록과 Google OAuth 클라이언트에 등록합니다.

다음 중 하나가 일어나기 **전에** 릴리스 환경을 분리합니다. 외부 호스트가 실제 Google 캘린더를 연결하는 경우, 팀 외부 사람들에게 실제 이메일이나 iMessage 전달을 활성화하는 경우, 스키마가 변경되어도 데이터를 유지해야 하는 경우입니다. 그 전까지는 보호할 것이 없으며 하나의 환경이 일관성을 유지하기에 더 간단합니다.


## Google 신원과 캘린더

MVP는 Supabase Auth를 통한 Google 전용 호스트 로그인을 요구합니다. 호스트 로그인과 요청자의 **Continue with Google**은 각각 하나의 동의 화면에서 신원과 Calendar 스코프를 요청하지만, 신원 로그인, 호스트 자격, 호스트 캘린더 동의, 요청자 신원 미리 채우기, 요청자 캘린더 동의, 개인 에이전트 OAuth는 서로 분리된 인가 경계로 남습니다. Calendar 스코프와 오프라인 접근을 Supabase Auth를 통해 전달합니다. Google은 사용자가 스코프를 해제할 수 있게 하고 Supabase는 이를 전달하지 않으므로, 부여된 스코프는 Google의 토큰 정보 엔드포인트에서 읽습니다. Supabase는 공급자 리프레시 토큰을 로그인 시점에만 반환하고 공급자 토큰을 갱신하지 않으므로, 로그인 시점에 서버 측에 저장합니다. 호스트가 Calendar 스코프를 해제했거나 스코프를 읽을 수 없었더라도 그 토큰은 봉인된 채로 보관합니다. Google은 첫 동의에서만 리프레시 토큰을 반환하므로 로그인은 방문할 때마다 `prompt=consent`를 강제하지 않으며, 나중에 Calendar를 허용한 호스트도 저장된 토큰을 갖게 됩니다. 저장된 스코프는 Google이 보고한 Calendar 스코프만 기록하며, 이를 생략한 이후의 동의는 아무것도 취소하지 않습니다. 이메일/비밀번호, 이메일 OTP, 매직 링크 호스트 로그인은 활성화하지 않습니다.

### 호스트 로그인 값

2026-10-19에 [기반 변경](../../openspec/changes/application-foundation/design.md#12-authentication-details)이 기록했습니다.

- **OAuth 클라이언트.** Google Cloud 프로젝트 `findmeatime`의 웹 OAuth 클라이언트 하나가 모든 환경을 담당합니다. 그 ID와 시크릿은 `GOOGLE_CLIENT_ID`와 `GOOGLE_CLIENT_SECRET`입니다. 로컬 스택은 루트 `.env`를 쓰고, 공유 프로젝트는 `GOOGLE_CLIENT_ID` GitHub 변수와 `GOOGLE_CLIENT_SECRET` GitHub 시크릿을 쓰며, 배포 워크플로가 `supabase config push`로 이를 기록합니다.
- **스코프.** Supabase Auth는 `openid`, `email`, `profile`을 요청하고, 애플리케이션은 `access_type=offline`과 함께 `https://www.googleapis.com/auth/calendar.calendarlist.readonly`(캘린더 목록), `https://www.googleapis.com/auth/calendar.events`(선택한 캘린더의 이벤트 읽기와 예약 이벤트 생성), `https://www.googleapis.com/auth/calendar.events.freebusy`(호스트가 접근할 수 있는 캘린더의 free/busy)를 추가합니다. 각 스코프가 인가하는 API 메서드와 함께 [`lib/contracts/google-scopes.ts`](../../lib/contracts/google-scopes.ts)에 정의되어 있습니다.
- OAuth 클라이언트의 **승인된 리디렉션 URI**는 Supabase Auth 서버마다 하나씩입니다.

  | 환경 | 리디렉션 URI |
  |---|---|
  | 로컬 스택 | `http://127.0.0.1:54321/auth/v1/callback` |
  | 공유 `anelszynxtvxoxqvzgqt`(릴리스 origin) | `https://anelszynxtvxoxqvzgqt.supabase.co/auth/v1/callback` |

  각 팀원의 샌드박스는 자신의 `https://<ref>.supabase.co/auth/v1/callback`을 추가합니다.
- **Supabase 사이트 URL과 리디렉션 허용 목록.** Supabase Auth는 허용 목록에 있는 애플리케이션 콜백으로만 돌아갑니다. 공유 프로젝트는 정식 origin인 사이트 URL `https://findmeatime.com`과 허용 목록 `https://release.findmeatime.com/auth/callback`, `https://findmeatime.com/auth/callback`, `http://localhost:3000/auth/callback`을 사용하며, 이는 `SUPABASE_AUTH_SITE_URL`과 `SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS` GitHub 변수로 설정합니다. 로컬 스택은 루트 `.env`의 `http://localhost:3000`과 `http://localhost:3000/auth/callback`을 사용합니다. 샌드박스는 ref를 확인한 뒤 같은 두 변수를 `supabase config push --project-ref <sandbox ref>`로 적용합니다.
- **애플리케이션 콜백.** `/auth/callback`은 항상 요청이 들어온 origin의 `/app`으로 돌아갑니다. 취소되었거나, 재사용되었거나, 다른 브라우저에서 돌아온 경우에는 세션을 만들지 않고 `/app?sign_in=failed`로 이동합니다.
- **둘 이상의 origin.** 하나의 배포가 `https://findmeatime.com`(`APP_ORIGIN`, 정식 origin)과 `https://release.findmeatime.com` 같은 다른 origin을 함께 제공할 수 있으며, 다른 origin은 `APP_ALLOWED_ORIGINS`에 쉼표로 구분해 나열합니다. 나열된 각 origin은 독립적으로 로그인하고, Google에서 돌아오고, 교차 사이트 Origin 검사를 통과하며, (https에서) Secure 쿠키를 받습니다. 그 페이지는 나열된 다른 origin으로 요청을 보낼 수 없습니다. URL이나 전달된(forwarded) 헤더에서 나열되지 않은 호스트로 향한 요청은 421로 거부되며 리디렉션되지 않습니다. 나열된 모든 origin의 `/auth/callback`을 `SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS`에 추가하십시오. 그렇지 않으면 Supabase Auth가 그 origin의 로그인을 사이트 URL로 보냅니다.
- **이메일 로그인.** `[auth.email] enable_signup = false`가 이메일 공급자를 비활성화하므로, 이메일/비밀번호, OTP, 매직 링크 요청은 `email_provider_disabled`로 실패하고 메일을 보내지 않습니다. 호스팅된 Cloudflare SMTP 설정은 `config.toml` 밖에 있으며 푸시로 바뀌지 않습니다.
- **런타임 Calendar 접근.** 2단계부터 웹 서비스와 에이전트 서비스도 `GOOGLE_CLIENT_ID`와 `GOOGLE_CLIENT_SECRET`(같은 클라이언트)을 읽어, 설정이 캘린더를 읽거나 분석이 실행될 때 호스트의 저장된 권한 부여를 갱신합니다. 두 값은 Vercel Production에 설정하고 Preview에서는 설정하지 않은 채로 두십시오. Preview에서는 Calendar 단계가 구성 사용 불가를 보고합니다. `GOOGLE_OAUTH_TOKEN_URL`과 `GOOGLE_CALENDAR_API_URL`은 테스트와 로컬 실행을 대역(stand-in)으로 향하게 하며 프로덕션 배포에서는 무시됩니다. Calendar 스코프를 거절한 호스트는 `/auth/sign-in?consent=calendar`로 다시 연결하며, 추가 리디렉션 URI는 필요 없습니다. 요청자의 **Continue with Google**은 기본적으로 같은 클라이언트를 사용합니다. 이 권한 부여는 삭제 전용입니다. 종료, 링크 만료, **Disconnect** 시 저장된 토큰을 삭제하고 Google의 철회 엔드포인트는 호출하지 않으므로, 클라이언트를 공유해도 호스트의 Calendar 권한 부여가 사라지지 않습니다. 따라서 호스트 클라이언트에는 리디렉션 URI `https://findmeatime.com/connections/google/callback`, `https://release.findmeatime.com/connections/google/callback`, `http://localhost:3000/connections/google/callback`과 동의 화면의 `calendar.events.readonly` 스코프도 필요합니다. `GOOGLE_REQUESTER_CLIENT_ID`와 `GOOGLE_REQUESTER_CLIENT_SECRET`은 선택 사항이며, 설정하면 웹 서비스와 작업 워커가 대신 그 클라이언트를 사용하고, 그 클라이언트에도 같은 리디렉션 URI가 필요합니다. `GOOGLE_REQUESTER_AUTH_URL`과 `GOOGLE_TOKEN_INFO_URL`은 테스트와 로컬 실행을 대역으로 향하게 하며 프로덕션 배포에서는 무시됩니다.
- **게시 상태.** 2026-10-20에 사용자가 보고한 대로 **Testing**이며, Calendar 스코프 검증은 아직 제출되지 않았습니다. OAuth 앱이 **Testing** 상태인 동안 Google은 7일 뒤 만료되는 리프레시 토큰을 발급하고, 등록된 테스트 사용자만 로그인할 수 있습니다. Phase 2가 저장된 권한에 의존하기 전에 **In production**(미검증, 사용자 100명 상한)으로 옮기고, Phase 2 초기에 Calendar 스코프 검증을 제출하십시오.

점검에서는 OAuth 애플리케이션의 소유권/게시 상태와 민감한 Calendar 스코프에 대한 Google 앱 검증, 정확한 콜백 URL, 최소 권한, 호스트 대 요청 범위 상태, 취소/재생(replay)/잘못된 브라우저 거부, 리프레시, 연결 해제/재연결, 읽기 쉬운 실패 메시지를 기록해야 합니다. 호스트 캘린더 역할에는 실제 메타데이터/쓰기 권한이 필요합니다. 요청자 동의는 가용성 전용이며 호스트 자격이나 계정이 필요하지 않습니다. 암호화된 권한 부여(grant)는 서버 측에 보관하고, 어느 참여자의 비공개 이벤트도 상대방에게 드러내지 않습니다.

## Cloudflare Email Service

연락처 인증, 비공개 복구, 예약 확정 메시지에는 발신자 `no-reply@findmeatime.com`으로 Cloudflare를 사용합니다. 승인된 통제 수신자를 사용해 발신자/도메인 소유권, API 권한, 전달 결과, 공급자 재시도 한도를 검증합니다. API 수락과 받은편지함 전달은 별개입니다.

[이메일 전달 계약](../../openspec/specs/email-delivery/spec.md#requirement-separate-transactional-sending-from-conversations)이 요구하는 대로, 로그인과 무관한 해당 Supabase Auth 알림에는 Cloudflare 커스텀 SMTP를 사용합니다. 호스팅 Auth 인수 전에 선택된 프로젝트의 호스팅 SMTP 설정, 발신자/도메인, 해당 알림 라우팅을 검증하며, 현재 설정과 전달은 검증되지 않았습니다. 해당하는 프로덕션 Auth 알림은 대체 발신자 없이 Cloudflare SMTP를 통해 `no-reply@findmeatime.com`을 사용해야 합니다. 해당하는 경우 통제된 알림 증거를 기록하며, SMTP 설정만으로는 받은편지함 전달이 증명되지 않습니다. 이는 Google 전용 로그인을 유지하며, 이메일/비밀번호, 이메일 OTP, 매직 링크 로그인을 활성화하거나 비밀번호 재설정 로그인 여정을 추가하지 않습니다.

### 운영자의 호스트 제어

별도의 관리자 CLI가 명시적인 환경과 운영자 권한으로 호스트 계정을 정지하고 복원하며, 이메일은 보내지 않습니다. 정지는 운영자의 남용 방지 수단이며 공유 호스트 자격 가드를 통해 효력이 발생합니다. 일상적인 JSON/로그에는 비공개 호스트 데이터를 출력해서는 안 됩니다. 정지, 복원, 복구는 감사되며 서로 구분되는 상태입니다.

## AgentMail

요청자 대화용 인박스, 스레드, 답장에는 AgentMail을 사용합니다. 인박스 할당/소유권, 웹훅 인증, 정확한 수신자 세대(receiver generation), 인증된 발신자 증거, 요청/스레드 등록(enrollment), 중복이 제거된 수신(ingress), 내구성 있는 디스패치, 발신 부모 메시지(outgoing-parent) 기반 지속, 철회/종료 동작을 검증합니다. 브라우저에서 생성한 요청 등록과 함께 최초 이메일 접수도 필요하며, 앞의 것만 구축해서는 채널을 완성할 수 없습니다.

선택된 주소는 **`findmeatime@agentmail.to`**이고 표시 이름은 **Find Me a Time**입니다. 이 주소는 모든 호스트와 요청이 함께 쓰는 하나의 제품 인박스이며, 새 스레드는 제목의 `@handle`로 호스트를 지정하고 답장은 스레드 바인딩을 따릅니다([`requester-email-channel`](../../openspec/changes/requester-email-channel/proposal.md#decisions), D2). 현재 계정의 인박스 3개 한도 때문에 프로비저닝이 막혀 있으므로, 선택된 인박스를 만들고 애플리케이션 키 접근을 확인할 때까지 기존에 동작하는 설정을 유지합니다. 의도한 애플리케이션 리소스를 위해 `AGENTMAIL_API_KEY`, `AGENTMAIL_POD_ID`, `AGENTMAIL_INBOX_ID`를 설정합니다. 범위가 좁은 `inbox_read`, `message_read`, `message_send` 권한을 사용하고, 프로비저닝과 웹훅 관리는 운영자 자격 증명에 한정합니다. 인박스가 만들어지면 운영자는 `message.received`용 웹훅을 `{origin}/agentmail/webhooks/{receiverId}`(에이전트 서비스로 라우팅됨)에 만들고, 웹훅의 서명 시크릿을 에이전트 서비스의 `AGENTMAIL_WEBHOOK_SECRET`으로 저장하며, `npm run admin -- email-receiver register --inbox <inbox> --webhook <webhook ID> --operator <name> --project <ref>`로 수신기를 기록합니다. 이 명령은 시크릿의 지문(fingerprint)만 저장하고 해당 인박스의 이전 수신기를 비활성화합니다. 테스트와 로컬 실행은 `AGENTMAIL_API_URL`로 API를 스탠드인에 연결하며, 프로덕션은 이를 무시하고 로컬 실행은 루프백 스탠드인으로만 발송합니다.

커스텀 도메인은 유료 플랜에서 지원됩니다. `agents.findmeatime.com`처럼 별도로 등록한 서브도메인은 `hello@agents.findmeatime.com` 같은 주소를 호스팅하면서 루트 도메인의 메일 라우팅은 분리해 둘 수 있습니다. 이는 선택된 인박스가 아니라 선택 사항인 향후의 주소입니다. 전환하기 전에 AgentMail이 제공하는 정확한 DNS 레코드를 Cloudflare에 추가하고 도메인을 검증하며, Cloudflare의 트랜잭션 발송과 기존 메일 레코드는 보존합니다. [커스텀 도메인](https://docs.agentmail.to/custom-domains), [MX 공존](https://docs.agentmail.to/knowledge-base/mx-record-conflicts), [플랜 제공 여부](https://www.agentmail.to/pricing)를 참고하십시오.

재시도 전에 실제 멱등성/조정(reconciliation) 한도를 기록합니다. 공급자 수락, 서명된 수신(ingress) 픽스처, 실제 다중 턴 받은편지함 전달은 서로 별개의 인수 증거입니다. 호스트 비공개 이메일은 초기 릴리스 밖의 제안된 확장으로 유지합니다.

## Photon

Photon Spectrum이 iMessage 전송 수단입니다. 6단계 스파이크는 내구성 있는 수신, 확인 응답, 정확한 발신자 신원, 복구를 기준으로 eve의 네이티브 `photonIMessageChannel` 대신 애플리케이션 자체 어댑터를 선택했습니다 ([`host-imessage-channel` 설계 1](../../openspec/changes/host-imessage-channel/design.md#1-the-transport-spike-and-the-adapter), D1). 네이티브 채널은 프로세스 내 디스패치 이후에 웹훅에 응답하며 아무것도 저장하지 않고, iMessage 스레드마다 eve 세션 하나를 유지하며, 발신함이 없습니다. `{origin}/photon/webhook`의 수신기(에이전트 서비스로 라우팅)는 `X-Spectrum-Webhook-Id`를 `PHOTON_WEBHOOK_ID`와, `X-Spectrum-Signature`(`v0=`와 `PHOTON_WEBHOOK_SECRET` 아래 `v0:{X-Spectrum-Timestamp}:{raw body}`의 16진수 HMAC-SHA256, 300초 이내)를 검사하고, `200`으로 응답하기 전에 영수증을 저장합니다. 발신 메시지는 `PHOTON_PROJECT_ID`와 `PHOTON_PROJECT_SECRET`으로 Spectrum SDK(`@spectrum-ts/core`와 `@spectrum-ts/imessage` 12.14.0)를 사용하며, 테스트와 로컬 실행은 `PHOTON_API_URL`을 루프백 대역으로 지정합니다. 프로젝트 하나에 회선 하나입니다(D7). 그 번호는 `PHOTON_LINE_NUMBER`이며, `PHOTON_FALLBACK_DAILY_LIMIT`(기본값 20)가 대체 코드로 시작되는 회선당 하루(롤링) 신규 대화 수를 제한합니다. 발신자 식별자(D2)는 Photon의 `message.sender.id`로, E.164 번호 또는 Apple ID 이메일이며, 정확히 일치 비교하고 해시 및 봉인해서만 저장합니다. 직접 대화(`space.type = "dm"`)만 인정됩니다. 이 사실들은 Photon의 문서, SDK, eve에 포함된 어댑터에서 얻은 것이며, 회선 프로비저닝, 웹훅 등록, 실제 iPhone에서의 식별자 확인은 아직 열려 있는 운영자 단계입니다.

### 첫 메시지와 호스트 온보딩

Photon의 전달 가능성 안내에 따라 인바운드 우선이 기본값입니다. 인증된 활성 호스트가 **iMessage 연결(Connect iMessage)**을 누르면 일회용 연결 코드를 가져와 곧바로 회선 번호와 연결 메시지가 입력된 메시지 앱을 열고(iOS는 `sms:<number>&body=<text>`, Android는 `sms:<number>?body=<text>` 형식을 기대합니다. 데스크톱에서는 번호, 코드, **코드 복사(Copy)**, iOS 딥링크 QR 코드가 담긴 인라인 카드를 보여 주며, 실제 iPhone에서 미리 채워진 입력과 QR 코드를 검증합니다), 호스트는 자신의 iMessage에서 그 코드를 보내고, 시작한 브라우저에서 마스킹된 발신자를 확인합니다. 따라서 서비스의 첫 메시지는 답장입니다. 호스트가 기기에서 보낼 수 없을 때의 대체 경로는 서비스가 보낸 6자리 코드를 브라우저에 입력하는 방식입니다. 이는 새 아웃바운드 대화로 집계되며, Photon은 이를 회선당 하루 한도로 제한하고 수신자에게 정크 배너로 표시하므로 사용 빈도를 기록합니다. 코드 없이 iMessage에서 먼저 시작한 소개는 브라우저 핸드오프로 이어지며 비공개 접근 권한은 주지 않습니다. 두 경로 모두에서 잘못된/만료된/재사용된 코드, 다른 번호에서 보낸 코드, 재전송 한도, 불확실한 전달, 브라우저 바인딩, 연동 해제를 테스트합니다. 코드는 웹 대화 기록과 모델 컨텍스트 밖에 두고(채널이 모델 턴 이전에 수신 연결 메시지를 소비합니다), 마스킹된 발신자와 상태만 표시합니다.

통제된 iPhone에서 요청 선택, 비공개 논의, 수정, 정확한 제안의 승인/거절을 검증합니다. 지원되지 않는 수신자와 그룹에는 비공개 상태를 보내서는 안 됩니다. 실제 디바이스/클라이언트 버전을 기록하며, 전송 성공만으로는 디바이스 수신이나 귀속을 증명할 수 없습니다.

### 표시 이름, 연락처 카드, 프로필 동기화

검증된 비공개 대화 이후 호스트 동작으로서 선택적인 **연락처에 추가(Add to contacts)**를 제공하며, 연결된 카드는 Spectrum SDK를 통해 네이티브 연락처 카드 공유 하나를 대기열에 넣습니다([`host-imessage-channel` 설계 11](../../openspec/changes/host-imessage-channel/design.md#11-add-to-contacts)). 실제로 선택된 경로를 고정하고, 공급자의 수락/불확실성을 사실대로 보고합니다. 저장 여부는 수신자가 선택하며, 제품은 표시되는 이름을 약속하거나 연락처 카드로부터 신원/동의를 추론할 수 없습니다. 지원한다고 주장하기 전에 실제 계정 프로필과 실제 디바이스에서의 표시를 각각 독립적으로 검증합니다.

## 모델 접근과 런타임

모델 설정은 서버 측에 두고 팀의 자체 API 키로 OpenAI를 직접 호출하며, AI Gateway는 사용하지 않습니다. 모델은 `gpt-5.6-terra`이며 2026-10-19에 결정되어 [기반 설계](../../openspec/changes/application-foundation/design.md#5-model-route-and-model)에 기록되어 있습니다. 기반 변경에서 팀의 키를 기준으로 모델 ID, 가격, 도구 지원을 확인하되, 합의된 [모델 한도](../../openspec/specs/model-execution/spec.md)를 강제합니다. 합성 컨텍스트를 사용해 유효하지 않거나 거부된 출력, 공급자 마감 시간, 속도/크레딧 실패, 내구성 있는 사용량 계산, 비공개 데이터 필터링을 테스트합니다. 모델의 실패가 스케줄링 상태를 진행시키거나 승인을 만들어서는 안 됩니다.

에이전트 서비스는 `/eve/v1`에서 두 가지 자격 증명만 받습니다(기반 설계 결정 7). 하나는 웹 서비스가 `EVE_INTERNAL_SIGNING_KEY`로 서명하는 60초짜리 내부 bearer로, 세션을 만들거나, 현재 수락된 입력을 보내거나, 놓친 턴 종료를 맞출 때 세션 하나의 기록을 읽는 데 씁니다. 다른 하나는 자신의 현재 세션을 스트리밍하기 위한 브라우저의 Supabase 세션 쿠키입니다. 에이전트 서비스도 bearer에 서명합니다. 세션이 유휴 상태가 되면 세션 소유자 훅이 대화의 다음 수락된 입력에 대한 send bearer에 서명해 자신의 `/eve/v1` 경로로 보내므로, 자신에게 도달하기 위해 `EVE_AGENT_URL` 또는 `APP_ORIGIN`이 필요합니다. 지금까지 이 자기 호출은 통합 테스트의 `eve dev`에서만 실행되었고 배포에서는 확인되지 않았습니다. 한 환경의 두 서비스에는 같은 `EVE_INTERNAL_SIGNING_KEY`(32자 이상)를 설정하되, Production과 Preview에는 다른 값을 쓰고, 브라우저에 절대 노출하지 마십시오. bearer는 자신에 서명한 배포 환경과, send의 경우 메시지의 SHA-256도 담지만, Preview 배포가 Production bearer를 만들지 못하게 막는 것은 서로 다른 키뿐입니다. 에이전트 서비스는 세션 색인과 브라우저 세션을 확인하기 위해 `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`도 필요합니다. 로컬에서는 `npm run dev`가 루트 env 파일로 두 서비스를 시작하며, `.env.local`이 `.env`를 재정의합니다. 이 값들은 `supabase status -o env`의 로컬 스택 값이나 팀원의 샌드박스 값으로 설정하고, 공유 프로젝트나 릴리스 프로젝트로는 절대 설정하지 마십시오. 웹 서비스는 `EVE_AGENT_URL`로 에이전트에 도달하며, 로컬 `eve dev`의 경우 `http://127.0.0.1:2000`입니다. 배포에서는 이를 설정하지 않고 `APP_ORIGIN`을 사용하며, 구성된 프로젝트는 그 `/eve/v1` 경로를 에이전트 서비스로 보냅니다.

## 보호된 MCP OAuth 호환성

선택된 인가 서버를 [리소스 바인딩 인가 계약](../../openspec/specs/agent-client-authorization/spec.md)에 비추어 Supabase 로그인과는 독립적으로 검증합니다. 정확한 리소스, 콜백, PKCE, 현재 권한 부여, 리프레시 회전/재사용 처리, 철회, 잘못된 대상(audience)/범위 거부를 요구합니다. 연결 안내를 게시하기 전에 지원되는 프로토콜/클라이언트 등록 버전을 기록합니다.

[`agent-access` 변경](../../openspec/changes/agent-access/proposal.md#decisions)은 MCP 프로토콜 리비전 `2026-07-28`, `2025-11-25`, `2025-06-18`, `2025-03-26`과 클라이언트 ID 메타데이터 문서, 동적 클라이언트 등록, 사전 등록된 CLI 클라이언트 `fmat-cli`를 지원합니다. 각 환경에는 고유한 `AGENT_TOKEN_SIGNING_KEY`가 필요합니다. 이는 base64 PKCS#8 Ed25519 개인 키이며 `openssl genpkey -algorithm ed25519 -outform DER | base64`로 생성하고, Vercel 프로젝트의 Production과 Preview에 서로 다른 값으로 설정하며 브라우저와는 절대 공유하지 않습니다. 이 키가 없으면 토큰 엔드포인트가 구성 불가 상태를 보고하며 어떤 에이전트도 연결할 수 없습니다. 키를 교체하면 모든 액세스 토큰이 10분 이내에 무효화되며, 리프레시 토큰은 계속 작동합니다.

Dots, Muse, Instinct, ChatGPT, Codex, Claude, Claude Code를 각각 개별적으로 테스트하며, 두 가지 스킬 프롬프트, 호스트/요청자 범위, 사람의 확인을 포함합니다. SDK 픽스처나 다른 클라이언트의 성공으로는 충분하지 않습니다. 연결 경로, 테스트 환경, 각 클라이언트의 결과는 [개인 에이전트 클라이언트](09_agent_clients.md)에 있습니다.

## 환경 및 활성화 체크리스트

첫 원격 애플리케이션 스키마/API 활성화 전과 각 통제된 공급자 테스트 전에, 시크릿을 출력하지 않고 로컬/프리뷰/릴리스 설정, 프로젝트에 바인딩된 자격 증명, 소비자(consumer)를 식별합니다. 이 게이트는 공급자를 활성화하는 모든 변경에 적용되며 릴리스 감사까지 미루지 않습니다. 프리뷰는 기본적으로 실제 전달을 하지 않습니다. 활성화 전에 경쟁하는 콜백/워커 소비자를 파악해 펜싱하고, 롤백 책임 주체를 유지합니다. 정확한 명령은 해당 구현이 존재하고 검증된 뒤에만 기록합니다. 원격 스키마 푸시에는 저장소 지침에 따라 식별된 대상과 검토된 드라이 런이 필요합니다.

백업, 비식별 진단, 보존/삭제, 측정된 예산에는 운영 변경에서 런북이 필요합니다. 이 문서는 외부 메시징, 마이그레이션 배포, 프로덕션 승격을 허가하지 않습니다.
