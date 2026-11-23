# Design

## 1. One list of step names

`lib/contracts/setup-progress.ts` holds the four chat steps, their English and Korean names, the one-line overview and `setupStepLine` ("2/4 · Meeting hours"). It is browser-safe, so the service texts, the agent instructions (interpolated into the host setup fragment) and the web step labels read the same names. The web has more cards than the chat has steps; it uses the chat names where a card is the same step (**Meeting hours**, **Where you meet**) and shows the step name next to its existing "N of M" progress.

## 2. Who marks which step

The service sends steps 1, 2 and 4 itself (the default-roles message, the hours question and the slot image's summary), so it adds their progress lines. The agent writes the place question, so the instructions give it the exact line. The 4/4 line goes on the slot summary only before the first save (`records.confirmed` is null); a saved host who asks to see their open times gets no step line. The overview goes on the first setup message: the Calendar link in the welcome, or the default-roles message when Calendar is already usable at linking. The return from Google does not repeat it.

## 3. The other-calendars question

`defaultCalendarRoles` returns the other candidates only when that call saved the default, so the question is asked once; a later message about roles that already exist names none. The candidates are `recommendCalendarRoles`' conflict calendars other than the primary. Calendar names are other people's text, so they are quoted on one line (`quotedTitle`) and at most three are named, then how many more.

The hours question follows when the analysis settles, and the host may answer the calendar question before or after it. A reply that could answer either is read as the hours answer; a calendar added later reruns the analysis, and the existing rule offers changed hours once. Holding the hours question until the calendar question is answered was rejected: the issue keeps the primary-only default with no answer, and setup must not wait on an optional question.

## 4. The end of setup and the tutorial offer

The first save (the command result's `tutorialOffered`, which is true only when no settings were confirmed before) replies "Setup is done. Your booking link: …" and then the offer; a later save still replies "Saved." The `confirm_settings` tool tells the agent the same. `TUTORIAL_TEXT` moves to `lib/contracts/host-tutorial.ts` so the web card shows the same English line as the chat.
