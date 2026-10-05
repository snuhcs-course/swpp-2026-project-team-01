# F10 — Requests: send, withdraw, inbox grouping, accept with impact confirmation

## Intent
- A request = a code-proposed slot + a message the client writes themselves; the AI never sends anything. `[doc one_pager §4.6]` `[code]`
- Pending requests do not block the slot: several clients may ask for the same time and the host picks one. A client's own pending requests may not overlap each other (any host). `[doc]` `[code]`
- The host must see exactly what accepting will auto-decline, and the server must refuse if that changed. `[code impact token]`
- Re-check reality at every commitment point (send, accept) against freshly fetched calendars. `[doc FR-18]` `[code preflight]`
- Confirmation only writes in-app calendars; nothing claims Google was updated. `[doc F10]` `[code]`

## How the user is led
- **Request panel** (inside `SearchWorkspace`, opened by picking a candidate; Esc closes; textarea focused): eyebrow 예약 요청, heading = candidate label; field **보낼 메시지** (hint "최대 500자. 호스트가 요청과 함께 읽어요."); **요청 보내기** disabled until the message is non-empty; 닫기. Success → "요청을 보냈어요. 내 요청 보기".
- **/requests/sent** "내 요청" — "내가 보낸 미팅 요청과 진행 상태예요. 대기 중인 요청은 철회할 수 있어요." Cards: host name, status badge, label, message (left border quote), conflict note (F11). **철회** (danger, small) on pending. Empty → "보낸 요청이 없어요." + 예약하기.
- **/requests/inbox** "받은 요청함" — "다른 사람이 보낸 미팅 요청을 수락하거나 거절해요."
  - Pending groups (`InboxGroup`): multi-item group has a warn left border + "같은 시간대에 N건이 겹쳐 있어요. 하나를 수락하면 나머지는 자동 거절돼요."; each item: client, label, status, message, **수락** / **거절**.
  - **수락** → GET preview → inline confirm bar "겹치는 요청 N건은 자동 거절됩니다." (or "이 요청을 수락할까요?") with **확인** / 취소.
  - Sections 수락한 요청 / 거절·철회된 요청 / 만료된 요청 with counts.
  - Empty → "대기 중인 요청이 없어요." + (not hosting) "장소와 미팅 양식을 등록해 두면 …" + 호스트 설정.
  - Header nav shows the pending count badge on 받은 요청함 (red dot on the mobile menu button).

## Rules (verified, `server/services/booking-commands.ts`)
- **Send** (`requestMeeting`): search revision must equal `expectedSearchRevision`; slot must be one of the search's current candidates and `candidateState='ready'`; preflight both calendars; inside a transaction with sorted per-user advisory locks: receipts still valid, search unchanged, slot still bookable **and** passes the search's must conditions, no overlap with the client's own active pending requests (any host) → `overlapping_request`, place/type still active; insert with snapshots of place + meeting-type name + duration.
- **Withdraw / decline** (`decideRequest`): owner role check, `expectedRevision`, still pending and not expired; no calendar fetch needed.
- **Accept preview** (`previewAccept`): affected = other pending requests of the same host overlapping in time; returns an HMAC-signed token `{requestId, revision, hostId, affected[{id,revision}], expiresAt=now+5 min}`.
- **Accept** (`acceptMeeting`): verify token (signature, ids, revision, expiry, affected list identical now and again inside the transaction) else `accept_impact_changed` → UI closes the confirm bar so the host re-checks; preflight both calendars; definitions unchanged vs. snapshot else `meeting_definition_changed`; slot still computable with lead 0 else `slot_unavailable`; then accept, auto-decline affected, create one `events` row per participant `source='booking'` titled `미팅 · <other name> · <type name>` (`commit 1843e51`), bump both `schedule_revision`s.
- Expired = pending with start < now; computed on read, never stored (`core/booking.ts isExpired`).
- Inbox grouping: transitive overlap clusters ordered by start (`groupOverlapping`).
- Status set `pending | accepted | declined | withdrawn` (+ display-only expired). Cancelling accepted meetings is out of scope.

## Data / API
Table `requests` (+ `search_id`, snapshots, `definition_state`, `revision`, `decided_at`). Routes `POST /api/requests {searchId, expectedSearchRevision, slot, message}`, `GET /api/requests/:id/accept-preview`, `POST /api/requests/:id/accept {expectedRevision, impactToken}`, `…/decline {expectedRevision}`, `…/withdraw {expectedRevision}`. Reads `services/booking.ts sentRequests | inbox | pendingCount`.

## Code map
`server/services/booking-commands.ts`, `server/services/booking.ts` (read models; its create/accept/decline/withdraw functions are not called by any route — grep found no caller), `core/booking.ts`, `contracts/booking.ts`, `components/{InboxGroup,RequestCard,SentRequests,StatusBadge}.tsx`, `app/(app)/requests/{inbox,sent}/page.tsx`.

## Transplant unit
- Keep together: overlap rules (`core/booking.ts`), impact-token accept, snapshot check. The impact token is what makes "N건 자동 거절" truthful.
- If the target writes to Google on accept, that is new scope — this code deliberately never does.
