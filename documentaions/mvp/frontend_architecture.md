# Frontend Architecture — AI 미팅 예약 (가칭)

작성일: 2026-09-29 · 상태: 확정 (2026-09-29) · 상위: `technical_architecture.md` · 화면: `app_screen_list.md`

---

## 1. 원칙
- 페이지는 **서버 컴포넌트**로 만들고, 조회 데이터는 `src/server`에서 직접 받는다.
- 상호작용이 있는 부분만 **클라이언트 컴포넌트**로 만들고, 변경은 `/api/*`를 fetch로 호출한다. 성공하면 `router.refresh()`로 서버 데이터를 다시 받는다.
- 전역 상태 라이브러리는 쓰지 않는다. 현재 사용자는 쿠키로 관리하고, 대화 상태는 S5 페이지 안에서만 들고 있는다.

## 2. 라우트

```
src/app/
  layout.tsx                    # S0 헤더(UserSwitcher, Nav, 받은 요청 배지)
  page.tsx                      # → redirect('/book')
  book/page.tsx                 # S4 호스트 목록
  book/[hostId]/page.tsx        # S5 예약 대화 (+ S6 모달)
  calendar/page.tsx             # S1 내 캘린더
  settings/availability/page.tsx# S2
  settings/host/page.tsx        # S3
  requests/sent/page.tsx        # S7
  requests/inbox/page.tsx       # S8
```

## 3. 컴포넌트

| 컴포넌트 | 종류 | 화면 | 역할 |
|---|---|---|---|
| `UserSwitcher` | client | S0 | 드롭다운 → `POST /api/session` → refresh |
| `WeekCalendar` | client | S1 | 주 단위 넘기기, 일정 블록, 규칙 밖 음영 |
| `EventForm` | client | S1 | 일정 추가·삭제 |
| `AvailabilityForm` | client | S2 | 요일 7행 편집 |
| `PlaceList`, `MeetingTypeList` | client | S3 | 목록 CRUD. 양식 길이는 분 단위 숫자 입력 |
| `HostCard` | server | S4 | 예약 가능/불가 표시 |
| `ChatView` | client | S5 | 메시지 목록, 입력창, 로딩, LLM 장애 배너 |
| `FilterChips` | client | S5 | 칩 표시와 삭제 → `PATCH .../filter` |
| `OptionButtons` | client | S5 | 버튼 최대 3개. 클릭하면 `RequestModal`을 연다 |
| `RequestModal` | client | S6 | 메시지 입력(500자), 전송, 409 사유 표시 |
| `RequestList` | client | S7 | 상태 배지, 철회 |
| `InboxGroup` | client | S8 | 같은 시간대 묶음, 수락/거절, 자동 거절 N건 확인 |

## 4. S5 대화 화면의 데이터 흐름
- 초기 로드: 서버 컴포넌트가 대화(메시지, 필터, 마지막 버튼)와 슬롯 수를 넘겨준다.
- 전송
  1. 사용자 말풍선을 먼저 화면에 넣는다(낙관적 업데이트).
  2. `POST .../turns`를 호출한다.
  3. 응답으로 `{ assistantMessage, filter, count, options? }`를 받아 상태를 교체한다.
- 칩 삭제: `PATCH .../filter` → `{ filter, count, options? }`
- 버튼은 **메시지에 붙은 스냅샷**이다. 오래된 버튼을 눌러도 서버가 전송 시점에 다시 검증하므로(FR-31) 따로 무효화하지 않는다.

## 5. 표시 형식
- 모든 시각은 KST로 표시한다. 포맷 함수는 `src/core/time.ts`의 것을 공용으로 쓴다(버튼 문구가 서버와 같아지도록).
- 버튼 문구: `M월 D일(요일) HH:MM · 장소명 · 양식명`
- 칩 문구 예: `다음 주 · 반드시`, `월–목 · 반드시`, `13–18시 · 강`, `온라인 · 강`, `빠른 순`
