# P0–P4 implementation contract

API origin is `<SUPABASE_URL>/functions/v1/api`; all paths below are relative.
All JSON uses camelCase, with shared audience-safe types in `packages/contracts/index.ts`.
Host calls use a Supabase user JWT in Authorization. Guest continuation uses `X-Request-Token`.
Mutations supply `Idempotency-Key` and (when existing) `expectedRevision`.

| Method/path | Input | Output |
| --- | --- | --- |
| GET /health | — | `{ok:true}` |
| POST /waitlist | `{email,name?}` | `{status:'pending'}` |
| GET /hosts/:handle | — | HostProfile |
| GET /host/setup | host auth | SetupState |
| POST /host/invitations/redeem | `{token}` | SetupState |
| POST /host/setup | `{handle,displayName,rules}` | SetupState |
| POST /host/google/connect | — | `{url}` |
| GET /google/callback | OAuth code/state plus binding cookie | redirect to web |
| GET /host/calendars | host auth | `{calendars:CalendarOption[]}` |
| POST /host/calendar-settings | `{conflictCalendarIds,bookingCalendarId}` | SetupState |
| POST /host/calendar/disconnect | — | SetupState |
| GET /host/requests | host auth | `{requests:RequestView[]}` |
| POST /hosts/:handle/requests | MeetingDetails | `{request:RequestView,token:string}` |
| GET /requests/:id | guest token or owning host JWT | RequestView |
| POST /requests/:id/messages | `{text,expectedRevision}` | RequestView |
| POST /requests/:id/evaluate | `{expectedRevision}` | RequestView |
| POST /requests/:id/proposal | `{start,end,expectedRevision}` | RequestView |
| POST /requests/:id/agree | `{proposalVersion,expectedRevision}` | RequestView |
| POST /requests/:id/withdraw | `{expectedRevision}` | RequestView |
| POST /requests/:id/revise | `{start,end,location?,mode?,expectedRevision}` host | RequestView |
| POST /requests/:id/approve | `{proposalVersion,expectedRevision,confirmed:true}` host web | RequestView |
| POST /requests/:id/decline | `{expectedRevision}` host | RequestView |
| POST /requests/:id/google/connect | guest | `{url}` |
| POST /requests/:id/calendar/disconnect | guest | RequestView |

Backend calls service-only Postgres `public.fmat_command(p_operation text,p_actor jsonb,p_input jsonb)`.
Actor is server verified `{kind:'host'|'guest'|'worker'|'operator'|'public',id?,email?,requestId?,tokenHash?}`.
SQL never accepts caller claims from public Data API; EXECUTE is service-role only.
Operations are snake_case equivalents: waitlist_join, host_public, setup_read, invite_issue,
invite_redeem, setup_save, calendar_save/read/disconnect, requests_list, request_create/read,
message_add, candidates_save, proposal_create/revise, requester_agree/withdraw,
host_approve/decline, oauth_start/consume, jobs_claim/complete/fail, booking_prepare/dispatch/
confirm/uncertain/fail, and delivery operations. Implement an operation only in its owning phase.
Backend and database agents must agree exact internal shapes before extending these operations.

Database returns domain JSON or raises an exception with stable error code as message.
The backend translates code to HTTP status and neutral user-safe error text.
Durable booking/jobs and state updates must be atomic. PostgreSQL owns authority guards,
leases and stable booking identity; only booking adapter creates Calendar events.
AI can extract/rank using public request information; deterministic feasibility is mandatory.
Parent owns migrations, root tooling, configuration, deploy, phase status and commits.
