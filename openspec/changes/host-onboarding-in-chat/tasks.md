# Tasks

## 1. Suggestions

- [ ] 1.1 Count located appointments without guests, apply the hours rule and the 10:00–20:00 starter windows in `lib/server/analysis.ts` and `lib/contracts/setup.ts`. Verify unit tests for the scenarios of "Hours suggested from repeated times".
- [ ] 1.2 Add `placeCandidates` to the setup state for the model, quoted. Verify a unit test with a location written as an instruction.

## 2. Calendar roles

- [ ] 2.1 Save the default roles at link confirmation and on the return from Google for a linked host with a usable grant and no roles, and say so in the conversation. Verify integration tests with a writable and a read-only primary calendar.
- [ ] 2.2 Add `set_calendar_roles` for linked-conversation turns. Verify integration tests for adding a calendar, a read-only destination and a web turn.

## 3. Questions

- [ ] 3.1 Send the hours question once when the analysis settles, in English and Korean. Verify integration tests for done, failed and a replayed job.
- [ ] 3.2 Rewrite the setup and channel instructions for the two questions and the agreed tone.

## 4. Slot image and saving

- [ ] 4.1 Add `preview_next_week` from the feasibility rules, and the outbox `image` kind rendered with `next/og` and a bundled Korean font. Verify unit tests for the open ranges and a render test.
- [ ] 4.2 Send the image as an attachment over iMessage and WhatsApp, and in the stand-in. Verify integration tests through the stand-in.
- [ ] 4.3 Make `confirm_settings` require the current review's image and accept its stated answers. Verify integration tests for yes to the image, a change after it and a web turn.

## 5. Documents

- [ ] 5.1 Update `documentations/user_experience/05_host_onboarding_flow.md`, `documentations/technical_specification/04_agent_configuration.md` and `THIRD_PARTY_NOTICES.md` (the font).

## 6. Release

- [ ] 6.1 Teammate review.
- [ ] 6.2 On a real iPhone and a WhatsApp account, onboard from the landing to the booking link, and record that the image arrived and how the hours rule read the team's calendars.
