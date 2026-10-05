# F07 — Booking links and contacts (book only people you are connected with)

## Intent
- Reach is by invitation: every person has a personal link; opening it (or pasting it) makes the two people **mutual contacts**; only contacts can be booked — in real and demo modes alike. `[commit 9819e71]` `[commit 0f47dd1]`
- A link can be passed on but not guessed (18 random bytes). Renewing kills the old link without removing existing contacts. `[code comment]`
- The link must survive sign-in: a signed-out visitor signs in and lands back on the same link. `[code safeReturnPath]`

## How the user is led
- **Host settings** card "내 예약 링크" — "이 링크를 받은 사람이 열면 서로 연락처에 추가되고 나에게 미팅을 요청할 수 있어요." Read-only URL input (select on focus), **링크 복사** (status "링크를 복사했어요." / fallback "복사하지 못했어요. 링크를 직접 선택해 복사해 주세요."), **새 링크로 바꾸기** with confirm "새 링크로 바꾸면 지금 링크는 더 이상 열리지 않아요. 이미 추가된 연락처는 그대로예요. 바꿀까요?".
- **Invite page** `/invite/<token>` (card, centered): eyebrow "AI 미팅 예약"; title "<name>님이 미팅 예약 링크를 보냈어요"; states:
  - invalid/renewed → "링크를 열 수 없어요 · 링크가 잘못됐거나, 보낸 사람이 새 링크로 바꿨어요. 새 링크를 다시 받아 주세요." + 처음으로
  - own link → "내 예약 링크예요. 미팅을 요청받고 싶은 사람에게 보내 주세요." + 호스트 설정으로
  - signed in → "연락처에 추가하면 …" + **연락처에 추가하고 예약하기** → `/book/<hostId>`
  - signed out → "로그인하면 <name>님이 연락처에 추가되고 …" + Google 시작 (real) / 시작 (demo)
- **/book** top section: "상대에게 받은 예약 링크를 열거나 여기에 붙여 넣으면 서로 연락처에 추가돼요. 내 링크는 호스트 설정에서 복사할 수 있어요." + input "받은 예약 링크 붙여넣기" + **연락처에 추가**. Accepts full URL or bare token (`/([A-Za-z0-9_-]{24})\/?$/`).
- **/book** list shows only contacts; empty → "아직 연락처가 없어요 · 예약 링크로 추가한 사람이 여기에 나타나요." with actions 호스트 설정 / 내 시간 프로필.

## Rules (verified, `server/services/contacts.ts`)
- Token created lazily on first view (`inviteToken`), unique column `users.invite_token`.
- `acceptInvite`: unknown token → `not_found`; own token → `invalid_input`; inserts both directions `ON CONFLICT DO NOTHING` under advisory lock `contacts:<a>:<b>`.
- `canBook(client, host)` = row `(owner=client, contact=host)` exists. Enforced at `/book/[hostId]` (404) and `createSearch` (`not_found` "상대의 예약 링크로 먼저 연락처에 추가해 주세요").
- Table `contacts(owner_id, contact_id, created_at)`; RLS enabled, anon/authenticated revoked.

## Data / API
`POST /api/contacts {token} → {hostId, hostName}`, `POST /api/invite-link → {token}` (renew).

## Code map
`server/services/contacts.ts`, `components/InviteLink.tsx` (`InviteLinkCard`, `AddContactForm`, `AcceptInviteButton`), `app/invite/[token]/page.tsx`, `app/(app)/book/page.tsx`, migration `20261005030207_contacts_and_invite_links.sql`.

## Transplant unit
Independent of the scheduling engine; can be dropped into any app with users. If the target is an open "anyone can book me" model (Calendly style), skip `canBook` but keep the link page states.
