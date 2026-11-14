# Proposal

## Why

The guest screenshot OCR from PR #70 does not appear in host setup. Hosts with fixed work or class timetables outside Google Calendar must enter their repeating hours one by one. The user requested an English image-upload choice on the Calendar connection card so OCR can fill those hours quickly. Google Calendar remains connected to receive confirmed bookings. This is an urgent live onboarding hotfix; the user asked not to create an issue.

## What Changes

- Add **Don’t keep your regular schedule in Google Calendar? Upload a timetable** to the host connection card. It expands a file input, preview, reading state and editable weekly-hours review.
- Use the server-side, optional OpenAI OCR gate for an authenticated host's PNG, JPEG or WebP image up to 10 MB. Return only weekly time ranges, never image bytes or private extracted text, and reserve against the host's model allowance before the provider call.
- Save reviewed weekly hours in the revisioned setup draft. The host still connects Google Calendar, chooses a writable destination, reviews the full setup and confirms it.
- Keep the existing Google Calendar conflict checks and booking event creation, plus the guest screenshot flow.

## Capabilities

### Modified Capabilities

- `chat-workspaces`: host setup offers a reviewable schedule-image choice to fill the existing weekly-hours field.

## Impact

No database migration is needed: the reviewed hours use the existing revisioned draft and confirmed settings JSON. The model gate remains off by default per environment. The uploaded image and raw provider response are transient. Google Calendar consent and booking behavior remain required.
