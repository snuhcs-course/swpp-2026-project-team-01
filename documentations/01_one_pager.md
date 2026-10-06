# Find Me a Time

**An AI scheduling agent for external one-to-one meetings. It negotiates times and books only with host approval.**

Domain: [findmeatime.com](https://findmeatime.com)

Launch: publishing your own booking link and receiving meeting requests is invite-only, with a waitlist for prospective hosts. Requesters can contact an active host without an account or invitation and optionally connect Google Calendar for availability checks.

## Users

### Who

VC investors, founders, and professors who schedule frequent external one-to-one meetings across locations and time zones. The MVP targets hosts who use an iPhone and iMessage. Hosts can start setup in web or iMessage, use browser handoffs for sign-in and Google consent, and continue everyday scheduling in their linked private conversation. Web remains available throughout.

### Who not

People scheduling internal or group meetings.

## Problem

Availability alone misses focus time, priorities, and travel. Booking pages leave hosts to gather details and negotiate alternatives manually.

## Solution

- **Find suitable times:** Google Calendar and host rules enforce availability, duration, location, and travel buffers. AI gathers missing details and ranks valid options; only the host can waive preferences.
- **Negotiate across channels:** Requesters need no account. They use a booking link, email, or their own agent without seeing private calendar details.
- **Approve explicitly:** The host reviews or revises on a phone or through an authenticated personal agent. The agent may relay a decision, never make one. Changed proposals need fresh approval; stale replies and retries cannot duplicate bookings.

## Principles

- Only the host's approval of the current proposal authorizes booking.
- Private calendar details, preferences, and host discussions stay private.
- Chat, email, mobile, and agent clients share one request state.
