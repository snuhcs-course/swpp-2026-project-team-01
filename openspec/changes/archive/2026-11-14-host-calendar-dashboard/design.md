# Design

## Entry and navigation

`/app` shows the calendar Dashboard only after the host is ready. An incomplete host resumes setup, and a request or explicit workspace view still opens the existing conversation. The top bar uses the existing wordmark, Settings dialog, and workspace menu. The ready-host menu adds Dashboard and retains the existing destinations and handlers for Setup, Requests, iMessage, Connected agents, and Sign out.

## Calendar and language

The heading reads **Your week comes together here.** in bold Open Sans, followed by **See your plans and the meetings Thyme booked for you, side by side.** Google events use the muted blue/slate role; Find Me a Time bookings use the brand green role. Both have source labels, so color is not the only distinction. The host can switch between week and month views, turn each source on or off, navigate periods, and inspect a day's events and one event's details. The time axis and event details use the host's saved timezone. No messaging-channel status appears.

## Data and privacy

The API authenticates the caller and scopes database reads to the host account. It reads confirmed bookings and events from calendars selected for conflict checking or booking, and removes Google copies of confirmed bookings by event ID or iCalUID. Results are no-store and limited to a 45-day query range. If Google access fails, bookings still render with a warning. Calendar detail is not exposed to requesters.
