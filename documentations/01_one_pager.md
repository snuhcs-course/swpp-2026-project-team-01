# Find Me a Time

**An AI scheduling agent for external one-to-one meetings. It negotiates times and books only with host approval.**

Domain: [findmeatime.com](https://findmeatime.com)

Launch: anyone with a Google account can become a host. Signing in creates an active host account, and publishing your own booking link and receiving meeting requests follow once setup is complete. Requesters can contact an active host without an account and optionally connect Google Calendar for availability checks.

## Users

The product is two-sided. Every meeting has one **host**, who owns the calendar and the final decision, and one **requester** (guest), who asks for the host's time.

### Hosts

VC investors, founders, and professors who schedule frequent external one-to-one meetings across locations and time zones. The MVP targets hosts who use an iPhone and iMessage. Hosts can start setup in web or iMessage, use browser handoffs for sign-in and Google consent, and continue everyday scheduling in their linked private conversation. Web remains available throughout.

### Requesters

People who want a meeting with a host: a founder pitching an investor, a student or collaborator asking a professor, a partner or candidate meeting a founder. They are often one-time or occasional contacts in another city or time zone, and they have no relationship with the product before the request. They arrive through the host's booking link, by email, or through their own personal agent, and they must never need an account.

### Who not

People scheduling internal or group meetings.

## Problem

### For hosts

Availability alone misses focus time, priorities, and travel. Booking pages leave hosts to gather details and negotiate alternatives manually.

### For requesters

Asking a busy person for time means guessing at their availability, trading several messages to converge on a slot, and re-entering the same details on every booking page. A booking page shows empty slots without context: the requester cannot tell whether a slot fits the meeting's length, mode, or location, and when nothing fits they have no way to propose alternatives except by email. They also should not have to create an account or expose their own calendar just to receive a confirmed invitation.

## Solution

- **Find suitable times:** Google Calendar and host rules enforce availability, duration, location, and travel buffers. AI gathers missing details and ranks valid options; only the host can waive preferences.
- **Negotiate across channels:** Requesters need no account. They use a booking link, email, or their own agent without seeing private calendar details.
- **Approve explicitly:** The host reviews or revises on a phone or through an authenticated personal agent. The agent may relay a decision, never make one. Changed proposals need fresh approval; stale replies and retries cannot duplicate bookings.

## Principles

- Only the host's approval of the current proposal authorizes booking.
- Private calendar details, preferences, and host discussions stay private.
- Chat, email, mobile, and agent clients share one request state.

The [design principles](04_design_principles.md) guide agent capability parity, suggestion-first preferences, and separate user and administrator CLIs.
