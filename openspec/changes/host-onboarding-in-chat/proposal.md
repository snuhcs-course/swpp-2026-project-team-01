# Proposal

Tracking issue: #166

## Why

The Iteration 4 kickoff (2026-11-08) moved host onboarding out of the web: a host should start from iMessage or WhatsApp and finish there. Today the [iMessage start](../host-imessage-channel/proposal.md) already links the phone and lets setup continue in the chat, but two steps still need `/app`. Calendar roles are saved only by the web card (`setup.save_calendar_roles`), and meeting mode, location and travel mode count only after a card press ([`host-onboarding`](../host-onboarding/specs/host-setup/spec.md), "Explicit mode, location and transport answers"). So a host who stays in the chat cannot finish. The chat also asks setup field by field, with suggestions the host has to read as settings.

The kickoff asked for a shorter conversation that reads the host's calendar first: suggest meeting hours from when the host's meetings and appointments actually ran, suggest places from where they were, show next week's open slots, and end with the booking link.

## What Changes

- **The web only links.** After linking and Google sign-in from Thyme's link, setup happens in iMessage or WhatsApp. The page shown after linking (connected, check your phone, and a settings link) belongs to the web onboarding UI work, not this change.
- **Calendar roles by default.** When a linked host has a usable Calendar grant and no saved roles, the service saves the primary calendar as both the conflict calendar and the booking destination, starts the analysis and tells the host in one line. The host adds or changes calendars in words.
- **Two questions.** Thyme asks only about hours and places. Hours are suggested from the counted events of the scan, four weeks before and after, under a new rule (weekdays 10:00–20:00 adjusted to the host's repeated times). Places are suggested from the host's calendar locations at the level of a neighborhood or a station, and the same message asks how the host meets and how they usually travel. Every other field takes its inferred value or starter default without a question.
- **Slots as one image.** Thyme sends next week's open slots and their place as one timetable image and asks whether to open them. The host's yes saves the settings, accepting the answers the image shows, and Thyme sends the booking link. The full settings read-back before saving is removed.

## Decisions

D1–D7 were taken by the user on 2026-11-09 in the session that wrote this change; D8 was taken by the user on 2026-11-10.

| # | Decision | Choice |
|---|---|---|
| D1 | Where onboarding happens ([design 1](design.md#1-the-path)) | The web links the phone only; Google sign-in comes from Thyme's link; the rest is in iMessage or WhatsApp. Guests and agent clients (MCP, CLI) are out of scope. Rejected: phone-number accounts without Google, which would change the account model (`host_accounts` is one per Google identity) |
| D2 | The principle | In the chat, ask the minimum and let the host answer naturally. This is an exception to [one thing to think about at once](../../../documentations/03_design_principles.md#4-one-thing-to-think-about-at-once): the place message asks for place, meeting mode and travel mode together |
| D3 | Hours rule ([design 3](design.md#3-the-hours-suggestion)) | Count meetings with guests and located appointments without guests. Weekdays are one range from the earliest start to the latest end that at least two events reach, rounded to whole hours; it may be wider or narrower than 10:00–20:00. A weekend day joins only when it has two events. Fewer than five events: weekdays 10:00–20:00. Rejected: a range per weekday, which cuts a day to its few meetings and is hard to read in a chat |
| D4 | Place suggestions ([design 4](design.md#4-the-place-question)) | The model reads the most frequent calendar locations as quoted data and suggests areas such as "역삼동" or "강남역 근처"; the host may answer as loosely. Rejected: a geocoding API (a new key and cost) |
| D5 | Mode and travel ([design 4](design.md#4-the-place-question)) | Asked in the place message, in the tone "주로 어떻게 이동하시는지도 말해주시면 미팅 시간 잡는 데 참고할게요"; only a missing answer is asked again |
| D6 | Calendar roles ([design 2](design.md#2-default-calendar-roles)) | The primary calendar by default, changed or extended in words |
| D7 | Before saving ([design 5](design.md#5-the-slot-image-and-saving)) | One image of next week's open slots and their place replaces the settings read-back; the host's yes to it saves and the booking link follows |
| D8 | No inferred weekly limit | The weekly limit is never inferred; null unless the host sets one |

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `host-setup`: default calendar roles, the hours rule, place candidates for the model, answers accepted by the host's yes to the slot image, and the chat's two questions.
- `host-imessage-channel`: setup over iMessage and WhatsApp ends in the chat, with the slot image and the booking link.

## Impact

- `lib/server/analysis.ts` (counted events, the hours rule, place candidates), `lib/contracts/setup.ts` (starter windows), `lib/server/calendar-roles.ts`, `lib/server/setup-tools.ts`, `lib/server/setup-channel-tools.ts`, `agent/tools/setup.ts`, `agent/instructions/host-setup.ts` and `host-imessage.ts`.
- A slot preview from the feasibility rules (`lib/server/feasibility.ts`) and a rendered PNG (`next/og`) sent as an attachment: `lib/server/photon.ts`, `lib/server/imessage-outbox.ts`, the WhatsApp sender and the Photon stand-in. A bundled Korean font.
- Fixed texts in `lib/server/channel-texts.ts` and `lib/server/imessage-links.ts` (welcome, roles notice, hours question).
- The web setup cards keep working; the starter windows and the hours rule change there too.
- Related work: the web onboarding UI (post-link page), and the host-session and per-slot location work, which this change does not cover. The image shows one place for the week.
