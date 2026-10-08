# 팀원 테스트 배포 안내

> **현재 배포 상태: 운영 중 (2026-10-05).** 사용자 요청으로 일시 중지했던 Caltalk 배포를 다시 열었습니다. 메인 주소 https://caltalk-mvp.vercel.app 에서 HTTP 200 및 Caltalk 화면 응답을 확인했습니다.
## 현재 상태 (2026-10-05)

- 주소: https://caltalk-mvp.vercel.app
- Vercel 프로젝트: `SWPP-2026 / caltalk-mvp` (Hobby 플랜).
- 로컬 개발은 계속 `http://localhost:3000`에서 진행합니다. 배포 서버는 개발자 PC가 꺼져 있어도 실행됩니다.
- 기존 개인 Supabase 클라우드 프로젝트를 그대로 사용합니다. 로컬 앱과 배포 앱의 DB가 같으므로 요청·링크 변경도 공유됩니다.
- 웹 빌드와 배포가 완료됐으며 첫 화면 HTTP 200, 비로그인 요청 API HTTP 401, Google 로그인 시작 HTTP 307을 확인했습니다.
- **Google 배포 주소 설정 완료:** 사용자가 설정 완료를 알렸고, 재조회에서 Google 응답의 `redirect_uri_mismatch` 오류가 더 이상 나타나지 않는 것을 확인했습니다. 실제 계정 로그인과 미팅 전체 흐름은 별도로 확인해야 합니다.

## Google 설정 기록 및 추가 팀원 안내

### 1. Google 로그인 복귀 주소 (설정 완료)

1. [Google Cloud의 Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients)를 엽니다.
2. 기존 로컬 Caltalk에 사용한 프로젝트와 **웹 애플리케이션 OAuth 클라이언트**를 선택합니다.
3. **승인된 리디렉션 URI(Authorized redirect URIs)**에서 URI를 추가합니다.

```text
https://caltalk-mvp.vercel.app/api/auth/google/callback
```

4. 기존 `http://localhost:3000/api/auth/google/callback`도 유지하고 저장합니다. ‘승인된 JavaScript 원본’ 칸에 넣는 주소가 아닙니다.
5. 설정 반영 후 배포 사이트에서 Google 연결을 다시 진행합니다.

### 2. 테스트할 팀원 계정 등록

Google Auth Platform → **Audience(대상)** → **Test users(테스트 사용자)**에 사용할 팀원 Google 이메일을 추가하고 저장합니다. 기존 테스트 사용자는 그대로 유지합니다. 새 배포 주소를 만들었다고 모든 Google 계정의 연결이 허용되는 것은 아닙니다.

### 3. 팀원과 확인할 흐름

호스트 로그인·Google 최초 연결 → 요청 링크 생성 → 다른 브라우저에서 링크 접속 → Google 자동 확인 또는 연동 없이 시간 선택 → 요청 제출 → 호스트가 후보 수락 → 캘린더 등록·초대 수신을 확인합니다. 이 단계에서 수락 버튼을 누르면 실제 Google 일정과 초대가 만들어집니다. 호스트·요청자가 같은 PC를 사용한다면 서로 다른 브라우저 프로필이나 시크릿 창으로 세션을 구분합니다.

## 배포 설정과 재배포

배포는 GitHub 자동 배포 연결 없이 `apps/web` 디렉터리에서 Vercel CLI로 수행했습니다. GitHub에 push하는 것만으로 재배포되지는 않습니다. Vercel의 `production` 환경은 이 테스트 프로젝트의 고정 주소에 사용하는 환경 이름입니다.

```powershell
cd apps/web
vercel link --yes --project caltalk-mvp --scope swpp-2026
vercel deploy --prod --yes --scope swpp-2026
```

- 배포 서버: Next.js, Node.js 22.x. 앱 폴더 자체를 업로드하므로 Vercel Root Directory는 별도 하위 경로 없이 사용합니다.
- `APP_URL`: `https://caltalk-mvp.vercel.app`.
- Google 클라이언트 ID/Secret, Supabase URL/서버 Secret/공개 Auth 키, 토큰 암호화 키, 세션 키는 사용자 승인 후 해당 Vercel 프로젝트의 서버 환경 변수로 등록했습니다. 문서·GitHub에는 값을 포함하지 않습니다.
- 로컬 `.env.local`의 `APP_URL`은 localhost로 유지합니다. `.env.local`과 `.vercel`은 Git과 소스 배포에서 제외됩니다.
- 기존 DB의 암호화된 연결 정보를 사용하므로 `TOKEN_ENCRYPTION_KEY`를 임의로 교체하면 기존 토큰을 읽을 수 없습니다.
- Supabase 공용 프로젝트가 정해지면 마이그레이션과 환경 변수 변경으로 이전하며, 기존 데이터와 연결의 이전 범위는 별도로 합의합니다.

## 남은 확인

실제 계정으로 로그인한 뒤 양쪽 캘린더 조회, 요청 저장, 수락 및 초대 수신까지 배포 환경에서 확인해야 합니다. 현재 배포 성공을 전체 미팅 흐름의 검증 완료로 간주하지 않습니다.

## 계정·수동 요청 배포 추가 (2026-10-05)

Caltalk 이메일 계정, 저장된 Google 연결 재사용, 무연동 시간 선택 기능을 같은 주소에 배포했습니다. 계정 연결·요청 모드 마이그레이션은 기존 개인 Supabase에 적용했습니다. `SUPABASE_PUBLISHABLE_KEY`를 Vercel에 등록하고 Supabase Auth의 Site URL 및 로컬/배포 인증 복귀 URL도 반영했습니다.

**남은 설정: 일반 팀원 회원가입용 SMTP.** 이메일 확인을 계속 요구합니다. 기본 발송 서비스는 Supabase 조직에 허용된 이메일 등 제약이 있으므로 일반 팀원 가입이 모두 가능하다고 간주하면 안 됩니다. 기존 Google 로그인과 무연동 요청은 이 설정을 기다릴 필요가 없습니다. [쉬운 사용법과 SMTP 안내](accounts-and-manual-requests.md)를 참고하세요.

타입 검사·lint·로컬 빌드 및 Vercel 빌드는 통과했습니다. 새 계정 생성/인증 메일 수신/실제 Google 초대 발송은 수행하지 않았습니다. 로컬 Docker 엔진이 Windows 소켓 접근 오류로 시작되지 않아 로컬 DB reset 검증은 남아 있습니다. 마이그레이션 SQL 검토와 원격 dry-run 후 적용하고 컬럼·제약·RLS 상태를 조회했습니다.
