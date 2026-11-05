# Design

## State and authority

OCR returns proposed `weeklyWindows` only. The host adds them to the revisioned draft as an unaccepted `schedule_image` suggestion through `setup.suggest_image_windows`. After Google connection, the regular weekly hours question shows the detected times, where the host can accept or adjust them through `setup.update_draft`. The host then confirms the whole proposal through `setup.confirm_settings`. The existing Calendar consent, role selection and writable booking destination remain required.

No image, OCR text or unconfirmed hours enter host settings, the assistant or a guest projection. A host changing their weekly hours stays on their previously confirmed policy until the revised settings are confirmed.

## Upload boundary

`POST /api/setup/schedule-image` uses the normal authenticated-host and same-origin guards. It bounds the request body, checks PNG/JPEG/WebP signature and size, then reserves a `calendar_ocr` attempt under the host principal and the shared service allowance. Five attempts are allowed for that host in a rolling 24 hours. The adapter calls `gpt-5.6-terra` with `store: false`, a 30-second deadline and a strict weekday/time-only response schema. Validation strips extra fields before returning only up to 21 weekly ranges. Unreadable images and provider or budget failures leave manual entry available.

The UI says the hours repeat weekly. The host reviews and, if needed, edits any mistaken range in the weekly hours question before accepting it. OCR suggests only free ranges within visible, labeled days and hours. A screenshot with unclear labels returns no inferred hours. The Google connection action stays visible and the copy explains that bookings go into the chosen Google Calendar.

## Scheduling and booking

The confirmed weekly windows bound the request evaluation. The existing Google Calendar conflict check also reads the calendars the host chose. Host approval keeps the normal request lock, revalidation and job flow. The booking job creates the confirmed event in the chosen Google Calendar and sends the normal confirmations.

## Activation and verification

The host and guest OCR paths use `CALENDAR_OCR_ENABLED` and `CALENDAR_OCR_API_KEY` or `OPENAI_API_KEY` on the web runtime. Keep the flag off in an environment until a synthetic labeled weekly timetable has been tested against the intended model/key, model spending is verified, and the privacy notice is reviewed. Type, lint and unit checks run on this branch. Local database and browser checks require Docker and Node 24; record their results before promotion.
