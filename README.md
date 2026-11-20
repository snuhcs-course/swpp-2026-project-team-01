# Find Me a Time — Iteration 4 Demo

Find Me a Time is an AI scheduling assistant for one-to-one meetings. Thyme helps find a suitable time; a booking is made only after the host approves it.

## Iteration 4 demo video

[Watch / download the Iteration 4 demo](demos/iteration-4-demo.mp4) (MP4, 8.6 MB).

## How to run the demo

### Hosted demo

1. Open [findmeatime.com](https://findmeatime.com) with a team-provided Google test account.
2. As a host, connect a calendar and iMessage or Telegram. Continue setup in the imessage/Telegram chat: review Thyme's suggested meeting hours and places, confirm calendar notes, and preview available times.
3. Open the resulting booking link in a separate guest browser. Request a meeting, choose a proposed time, and observe the waiting-for-host status.
4. Return to the host's chat or workspace to review and approve the request. Check the booking in Google Calendar and the request status in the app.

An agent service can also follow the [MCP instructions](documentations/technical_specification/09_agent_clients.md) to connect Find Me a Time and guide host setup or a meeting request.

### Local development

The project uses Node.js 24, npm, Next.js, Eve, and Supabase. The hosted demo runs on Vercel with Google Calendar and the configured messaging services. For a local run, install Docker and Supabase CLI 2.119.0, then:

```sh
git clone --branch iteration-4-demo https://github.com/snuhcs-course/swpp-2026-project-team-01.git
cd swpp-2026-project-team-01
npm ci
cp .env.example .env
```

Set the required Google, model, and application values in `.env` as described in [provider setup](documentations/technical_specification/03_provider_setup.md). Start the local Supabase stack, use `supabase status -o env` to obtain its connection values, and put local overrides in `.env.local`:

```sh
supabase start
supabase status -o env
npm run dev
```

Open `http://localhost:3000`. In another terminal, run `npm run jobs:dev` to process locally created background jobs. Use the hosted demo for the configured iMessage and Telegram flows.

## Checks

Run `npm run check:docs`, `npm run lint`, `npm run typecheck`, and `npm test`. Integration and browser tests also need the local Supabase stack; see [agent guidance](AGENTS.md#tooling-prerequisites).

## What the demo demonstrates

### Features newly implemented in Iteration 4

- **Chat-based host setup:** Hosts can complete setup in iMessage or Telegram, respond to calendar-based suggestions, review note-like calendar events, and confirm a preview of their available times.
- **A clearer schedule and settings:** The calendar dashboard brings Google events, service bookings, and sent requests into week and month views. Hosts can review and edit preferences in the settings dialog.
- **A more complete meeting flow:** Guests see feasible in-person times paired with the host's places. After choosing a time, they see that host approval is still pending. Hosts can review sent and received requests, approve bookings, and cancel a booked meeting.
- **Guest updates:** Guests can choose email-only updates or receive updates in Telegram. A revised proposal shows what the host changed, and a host can request a meeting with another host using the same account.
- **Personal-agent access:** An external agent service can connect through MCP, guide host setup or a meeting request step by step, and start a messaging-channel link. Settings changes still require the host's own agreement.
- **Usability improvements:** Sign-in persists across page refreshes, fixed interface text is in English, and Thyme replies in the user's language. Telegram is offered in place of WhatsApp in the current interface.

Together, these changes extend the demo beyond the earlier web-based setup into a connected flow across chat, the calendar, the requests workspace, and personal agents. The first UAT cycle also showed where the test scenario needs to focus more tightly on core tasks.
