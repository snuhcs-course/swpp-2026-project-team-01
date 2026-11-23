# Tasks

## 1. Received requests on the Dashboard

- [x] 1.1 Add the `received` source to `readHostDashboard` for requests needing a decision with a proposal in the period, never samples; cover the event shape with unit tests.
- [x] 1.2 Draw it with its own filter, style, details (Proposed time · From · Purpose, Open request) and note; cover the labels with unit tests.

## 2. Schedule lookup in the messenger and MCP

- [x] 2.1 Add `lib/server/host-schedule.ts`: the local-day period, the labeled model projection over `readHostDashboard`, and the input schema; cover the period, the labels, quoting, omitted contact details and the Google failure with unit tests.
- [x] 2.2 Add `read_schedule` to the host setup tools and `get_schedule` (host:read, read-only) to the host MCP tools; cover the tool lists and scopes with unit tests.
- [x] 2.3 Tell the host setup instructions and the host entry document to answer schedule questions from the tool.

## 3. Documents

- [x] 3.1 Recheck H04 M-2 against #302, update H04 (W-1, W-5, M-2, M-2.1, M-2.2, M-4, M-5, P-3) and R01 M-8, and remove the weekly report row (M-6).
- [x] 3.2 Update the agent configuration, agent clients and DESIGN.md documents, and regenerate the Korean mirrors.

## 4. Verification

- [x] 4.1 Run lint, typecheck, unit tests and the documentation check.
- [ ] 4.2 Run the Dashboard browser journey and an integration read of a received request through `/api/host/dashboard` against the local stack (left to the owner on main).
