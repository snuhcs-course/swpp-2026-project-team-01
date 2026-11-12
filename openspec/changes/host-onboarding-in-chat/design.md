# Design

## Context

A host links iMessage or WhatsApp from the landing (`/?flow=imessage`, `/?flow=whatsapp`): number, code, Thyme's sign-in link, Google sign-in, **Confirm and link** ([`host-imessage-channel`](../host-imessage-channel/proposal.md) D15, D19; [`imessage-number-registration`](../imessage-number-registration/proposal.md)). Google sign-in already requests the Calendar scopes with identity (`lib/server/google-sign-in.ts`), so most hosts have a usable grant when the link is confirmed. The welcome then asks for Calendar or the first setup question (`LINK_TEXTS`, `lib/server/imessage-links.ts`).

Two steps block finishing in the chat: calendar roles (only `setup.save_calendar_roles` from the web saves them) and the host-answer fields (meeting mode, location, travel mode), which `missingFields` counts only when `accepted` (`lib/server/setup.ts`), set only by the web's `setup.update_draft`.

## 1. The path

1. Web: number, code, Thyme's sign-in link, Google sign-in with Calendar, **Confirm and link**. The browser then shows the post-link page owned by the web UI work.
2. Chat: the welcome. With a usable grant, the service saves the default roles (design 2), publishes the analysis and says so; without one, Thyme sends the Calendar link as today, and the same happens on the return from Google.
3. When the analysis settles (done or failed), the service sends the hours question (design 3) once.
4. Thyme records the host's answer and asks the place question (design 4).
5. Thyme sends the slot image and asks whether to open the slots (design 5). On yes it saves and sends the booking link.

The web setup cards keep working on the same draft.

## 2. Default calendar roles

When a linked host has a usable grant and no saved roles, at link confirmation or on the return from Google, the service runs `saveCalendarRolesCommand` as that host with the live calendar list: the primary calendar as the only conflict calendar and as the booking destination, under the existing checks (present in the list, writable). It publishes the analysis as saving roles does today. A host whose primary calendar is not writable gets no default and is asked in words.

A new setup tool, `set_calendar_roles`, works only for a turn from the linked conversation. It takes calendars by the quoted names `read_setup_state` lists (with their index, since names can repeat), and runs the same command, so the destination must be writable and every calendar must be in the live list. Changing roles publishes a new analysis as today.

## 3. The hours suggestion

Counted events, over the analysis scan of the four weeks before and the four weeks after: busy, timed events that either have another attendee who did not decline (as now) or have a location and no conference link. Note-like entries (no attendee, location or link) and all-day events are not counted.

- Fewer than 5 counted events: Monday to Friday 10:00–20:00, labeled starter default. This replaces the 10:00–17:00 starter windows everywhere.
- Otherwise, group weekday events together, Saturday separately and Sunday separately. A group with at least three events uses the second-earliest start of day and the second-latest end, so a single early or late event does not move the range. A group with exactly two events uses the earliest start and latest end. In both cases, round the start down and the end up to the hour.
- Monday to Friday get the weekday group's one window. With fewer than two weekday events, use Monday to Friday 10:00–20:00. Saturday or Sunday gets a window only when that day has at least two events.
- The whole suggestion is labeled inferred when any group has at least two events, including weekend-only evidence with the weekday default. If no group has at least two events, the whole suggestion is the starter default.
- An end past midnight keeps the existing next-day handling of `windowsFromSpans`.

Once analysis settles, the service sends the hours question once, including when weekday evidence is insufficient; it does not leave the question pending for that case.

The service sends the question as fixed text in the conversation's language, for example: "캘린더를 보니 평일엔 9시부터 저녁 10시까지 보통 약속이 있으시네요. 미팅 가능 시간을 평일 9시~22시로 잡아둘까요?" With the starter default it says it used 10시~20시 because there were few events. Thyme's instructions name this question, so a plain reply ("응", "8시까지만") is the hours answer, recorded with `draft_settings` as stated.

## 4. The place question

`read_setup_state` gains `placeCandidates`: up to five distinct location strings from the scanned events (busy, timed, a location and no conference link), each with its count, encoded as quoted data like calendar names. Thyme turns them into area suggestions at the level of a neighborhood or a station ("역삼동", "강남역 근처"), and says the host can answer that loosely.

The same message asks whether online also works and, in the agreed tone, how the host usually travels: "주로 어떻게 이동하시는지도 말해주시면 미팅 시간 잡는 데 참고할게요". Thyme maps the answer to `meetingMode`, `location` (`places` with areas, or a venue) and `travelMode`, all as stated. If the answer leaves the mode or the travel mode out, Thyme asks only for that, once. The travel buffer and the other fields take their inferred values or starter defaults without a question.

A candidate is never recorded by itself: it becomes a value only when the host names or accepts it in a turn from the linked conversation.

## 5. The slot image and saving

`preview_next_week` (setup tool, linked-conversation turns only) computes the open slots of next week (Monday to Sunday in the host's timezone) from the current proposal: weekly windows, duration, buffers and the busy time of the conflict calendars, with the feasibility engine's host rules and no requester. It queues one image message to the linked conversation and returns to Thyme the open ranges per day as text and the review reference.

The image is drawn in the landing's style (user, 2026-11-12): a two-line serif headline, a week grid (days across, hours down) with open time shaded on a white card over a soft board, and the place, the meeting mode, the travel mode and the duration as plain text under it. Its text is English in every conversation; only the place is shown as the host wrote it, and the caption carries the host's language. It is rendered at send time from the stored preview data with `next/og` `ImageResponse` in the job worker (a Node route handler), with bundled Geist, Instrument Serif and a Noto Sans KR subset for a Korean place. Without the fonts, `next/og` fetches glyphs from Google Fonts at render time, which a send must not depend on. The message carries a one-line text with the image (WhatsApp caption; a separate text on iMessage) so the host sees the ranges even if the image fails. A rendering scratch test on 2026-11-09 (Next 16.3.8, Node) produced a 22 KB PNG with Hangul in about 1.4 seconds.

Saving: `confirm_settings` keeps its reference check and drops the rule that Thyme listed every setting. It now requires that the latest preview sent to this conversation is for the current review, and it accepts the stated host-answer fields of that review before the confirmation command runs. So the host's yes to the image is the acceptance, in place of a card press. A changed draft after the preview needs a new preview. The reply carries the booking link as today.

## 6. Sending an image

The outbox gains an `image` content kind holding the preview data (not the PNG). The real transport renders the PNG and sends `attachment(buffer, { mimeType: "image/png", name })` through Spectrum: iMessage uploads and sends an attachment, WhatsApp uploads media and can pair it with a caption (`@spectrum-ts` 12.14.0, read in its code). The loopback stand-in accepts the kind as JSON. Telegram is outside this change; there the preview is sent as text.

## Risks

- Delivery of an image through Photon's shared line on a real phone is not yet verified; the release task checks it.
- Location strings are written by other people. They reach the model only as quoted data, and no value is saved without the host's turn and the final yes.
- The hours rule is new and untested on real calendars; the release task checks it on the team's calendars.
- The image reflects one review. If the host changes something after it, Thyme sends a new one before saving.
