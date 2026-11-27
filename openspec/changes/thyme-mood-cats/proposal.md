# Proposal

Tracking issue: #493 (one persona for the assistant). No issue of its own yet.

## Why

Thyme now has a profile picture, a blue cat, on the web, in emails and on the Telegram bot (#506, #509). The owner proposed on 2026-11-27 two more drawings of the same cat, a happy face and a sorry face, set at the end of Thyme's words the way a magazine sets a small mark where a piece ends. The happy cat closes a message in which something was decided; the sorry cat closes one in which Thyme owns a mistake. The marks make the persona felt at the two moments a guest remembers, without adding words.

The cats must never say more than the records do. A happy cat beside "Booked!" when nothing is booked would turn a wrong sentence into a confident one, so the happy cat follows recorded outcomes, not the model's wording ([base instructions](../../../agent/instructions/base.md): no booked, agreed, approved or saved without the record).

## What Changes

- **A sticker on the bubble's corner.** On the guest's web conversation, a Thyme message MAY end with one cat, 48px, overlapping the bubble's bottom-right corner and tilted slightly (option C in [preview-options.png](preview-options.png)). It is decorative; the words carry the meaning.
- **The happy cat follows records.** It appears on the Thyme message of a turn in which a guest decision was recorded (`agree_to_proposal` returned `recorded: true`), in which `read_booking_status` reported the meeting booked, and on the page's own booked notice. The model's wording never adds it.
- **The sorry cat has two sources.** It appears on the Thyme message of a turn in which a tool call failed (`output-error`), and when the assistant owns a mistake it made, by calling a new `show_cat` tool with `sorry`.
- **The guest may ask for the happy cat.** When the guest asks to see the happy cat, the assistant calls `show_cat` with `happy` and the message shows it. It is the only way the model adds a happy cat.
- **Limits.** At most one cat per message, only at the end of the message's last bubble, and not the same cat on two Thyme messages in a row unless the guest asked for it.
- **Web only.** Messenger and email replies are unchanged: `show_cat` changes no text, so nothing reaches `turnReplyText` or the messenger outboxes. A Telegram sticker is left for later (Non-goals).

## Decisions

Taken on 2026-11-27 with the owner in the session that wrote this proposal. They have had no teammate review yet; the tasks' **Teammate review** box covers them.

| # | Decision | Choice |
|---|---|---|
| D1 | How the cat sits on the message | A 48px sticker on the bubble's bottom-right corner, tilted 8°, as option C in [preview-options.png](preview-options.png). Rejected: an inline mark after the last word (option A) and a mark on a rule under the text (option D), where at 20–24px the happy and sorry faces could not be told apart; a stamp at the end of the last line (option B), which the owner liked less; changing the avatar's face (option E), which is not a mark at the end of the words |
| D2 | When a decision counts as made on the guest's web conversation | A recorded guest agreement, a booking that `read_booking_status` reports, and the page's booked notice. The host's approvals and saved settings happen only in the host's messenger (`chat-workspaces`: No host chat on the web), so they never show here. Rejected: only a confirmed booking, which a guest rarely sees in the conversation because a booking shows as cards |
| D3 | Who decides the happy cat | The records, read from the tool parts of the same message on the client, plus `show_cat` only when the guest asks for the cat. Rejected: the model deciding on its own, which could celebrate an agreement that was refused |
| D4 | How the model signals a cat | A `show_cat` tool taking `happy` or `sorry`, with no side effect, whose call the web hides from the tool trace. Rejected: a hidden marker in the reply text, which every channel path (`turnReplyText`, `imessageTurnText`, email) would have to strip, and one missed path would send the marker to a guest |
| D5 | Which system errors bring the sorry cat | A tool part in `output-error` in the message. A refusal returned as a normal output (`recorded: false`, for example a time that is no longer free) does not: it is the calendar's news, not Thyme's mistake, and the assistant's own words decide whether to apologize, through `show_cat` |
| D6 | When two sources disagree | One cat per message: a guest's request for the happy cat first, then sorry, then a recorded happy. A mistake in the same turn is not celebrated |
| D7 | Messengers | Web only for now. Telegram can show a sticker as a separate message after the reply (`sendSticker` with a 512px WEBP, free), which waits until the web shows how often the cats appear |

## Non-goals

- Cats in Telegram, iMessage, WhatsApp, KakaoTalk or email replies.
- Cats on the host's screens: the host has no web chat with Thyme.
- A sorry cat for the "Thyme stopped responding" status, which is not a Thyme message.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-workspaces`: Thyme's messages on the guest's web conversation may end with a happy or sorry cat.
- `meeting-requests`: the guest assistant shows the sorry cat when it owns a mistake and the happy cat when the guest asks for it.

## Impact

- `apps/web/public/thyme/` (the happy and sorry drawings on transparent backgrounds, 128px and 256px), `lib/contracts/thyme-cat.ts` (their paths, the `show_cat` input and the rule that chooses a message's cat).
- `apps/web/components/chat/message.tsx` (the sticker, the cat chosen from the message's tool parts, `show_cat` hidden from the trace), `apps/web/app/_components/guest/guest-conversation.tsx` (the previous message's cat, for the no-repeat rule), `apps/web/app/_components/guest/booked-workspace.tsx` (the booked notice).
- `agent/tools/request.ts` (`show_cat` for the requester), `agent/instructions/requester.ts` (when to call it).
- Unit tests for choosing the cat; requester eval cases for owning a mistake, for a refused agreement that must not show a happy cat, and for a guest asking for the happy cat.
- `DESIGN.md` (the sticker), the decision log and its `ko/` mirror.
- No schema change and no migration.
