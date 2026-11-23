# Design

## 1. Received requests on the Dashboard

`readHostDashboard` adds a fourth source, `received`, beside `google`, `thyme` and `sent`. It reads the host's own requests in `gathering`, `negotiating` or `awaiting_host_approval` that need a decision by the same rule as the Requests inbox (`awaiting_host_approval`, or a pending shared-change draft), never samples, joined to their latest proposal, and keeps those whose proposal overlaps the period. Each becomes an event at the proposal's time titled "Request from {requester}", carrying the request ID, requester name and purpose. A received request has no calendar event, so it never removes a Google event from the period and is never marked booked. A request with no proposal yet stays only in Requests.

The component adds a **Requests to decide** filter, a dashed amber treatment distinct from the three existing ones, and details with Proposed time · From · Purpose, **Open request** and a note that the time is not booked until the host approves it. The edits stay in the event sources and their rendering; week navigation is untouched.

## 2. One read-only schedule projection for the messenger and MCP

`lib/server/host-schedule.ts` turns a period of local days in the host's timezone (from a date, default today, for 1 to 31 days, default 7) into instants and calls `readHostDashboard`, so the messenger, MCP and the web calendar read the same events with the same de-duplication and calendar selection. The model projection gives each entry a `kind` (`booked_meeting`, `calendar_event`, `request_to_decide`, `sent_request`), its local date, start and end as display times with offsets, the week it falls in relative to now, and the current date and weeks (the `currentTime` shape `list_host_requests` uses). Titles, places and names pass through `encodeDisplayName` as quoted data, because a Google event can be written by anyone who invites the host. Guest email addresses and join links are not included. When Google Calendar cannot be read, the result says `googleCalendar: "unavailable"` and still lists Find Me a Time meetings and requests.

`read_schedule` is a setup-session tool behind `authorizeSetupTool`, so it exists only in the host's own setup conversation on the web and in the linked chat; it is not added to request review sessions. `get_schedule` is a host MCP tool with `readOnly: true` and `host:read`, the scope `list_requests` uses. Neither writes anything or takes a calendar ID: only the calendars the host chose are read.

## 3. Deferred: the schedule image

The slot image path assumes one image per settings review: `recordOutbound` requires a review hash for `kind = 'image'` (a table check), and `confirm_settings`, the setup command and the onboarding note step read the latest `image` row as the settings preview. Recording a schedule image as `image` would make the host's next settings confirmation stale. A schedule image therefore needs a new outbox kind with a migration, an event renderer next to `renderSlotPreviewPng`, and the three transports to send it. It is left for a follow-up on #330.
