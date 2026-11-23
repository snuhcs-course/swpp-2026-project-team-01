# Tasks

## Chat setup progress (#368)

- [x] Add the shared step names, overview and progress line in `lib/contracts/setup-progress.ts`.
- [x] Mark the calendar, hours and open-times service messages, put the overview on the first setup message, and say "Setup is done" with the booking link on the first save.
- [x] Tell the agent to mark the place question and to say setup is done after `confirm_settings`.
- [x] Use the same names for the web setup's meeting hours and place steps, and show the step name in the web progress line.

## Other calendars (#361)

- [x] Return the other recommended calendars from `defaultCalendarRoles` when it saves the default, and name them in the default-roles message with one question.
- [x] Tell the agent to save a yes or a named calendar with `set_calendar_roles` and to change nothing on a no.

## Tutorial offer (#377)

- [x] Explain the sample request in the offer before asking, in English and Korean, and use 샘플 요청 in the Korean feedback.
- [x] Show the shared offer text on the web card.

## Tests and documents

- [x] Unit tests for the step lines, the calendar question, the done reply, the offer text, the web labels and the host setup instructions; integration and browser expectations updated.
- [x] Update the host onboarding flow and the agent configuration, and regenerate their Korean mirrors.
- [ ] Run the integration and browser tests on main after merging.
