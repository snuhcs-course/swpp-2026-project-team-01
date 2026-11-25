# Agent setup controls

Status: implementation draft for [mcp-ux](../../openspec/changes/mcp-ux/proposal.md), tracking [#328](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/328). PR #342 is excluded. The capability deltas own the proposed behavior.

## Pause and resume

The host can say “Pause new meeting requests” or “Start accepting requests again” in linked iMessage or Telegram, from setup or a request discussion. Thyme reads the intake revision and saves through the same command as the web Settings toggle. The saved state appears in Settings. Existing requests and messenger bindings continue. STOP and unlink retain their existing connection-ending meaning.

MCP exposes `get_host_status.intake` with `accepting` and `revision`, plus `acceptingRequests` combining preference and readiness. `set_request_intake({accepting, expectedRevision, retryKey, hostWords})` needs `host:write`. A stale revision fails; an exact retry replays the original result. Turning the preference on cannot override missing setup, Calendar access or suspension.

## Publish an MCP change

`update_setup_field` still drafts a field. Its response now includes the current setup snapshot and `nextStep`; `get_setup.nextStep` also accounts for pending changes. With complete pending settings, the agent reads them back and calls `confirm_setup` with the latest revision, proposal hash and the host's agreement. Until success, evaluations use the previous confirmed policy.

## Week-specific hours

The optional `scheduleOverrides` setup field is available through MCP `update_setup_field` and the messenger's `draft_settings` or `change_settings`. Read the existing object and preserve unrelated entries before replacing it. The normal first-setup confirmation and ready-host save rules still apply. The web Settings dialog is unchanged; the draft exposes these advanced rules through the messenger and MCP.

```json
{
  "alternateWeeks": {
    "anchorWeek": "2026-11-23",
    "windows": [{"weekday": "monday", "start": "14:00", "end": "18:00"}]
  },
  "weeks": [{"weekStart": "2026-11-30", "windows": []}]
}
```

The anchor and replacement keys are real Monday dates in the host timezone. Alternating hours apply every two weeks in either direction from the anchor; other weeks use base weekly hours. A dated replacement takes priority and replaces the whole week; an empty window list closes it. At most 104 unique dated weeks and 21 windows per week are accepted. An overnight window belongs to the week of its start date, including its tail across Monday. Missing overrides preserve old behavior. Calendar conflict, buffer and DST checks still apply.

## Open-time previews

`preview_next_week` accepts optional `week: "this_week" | "next_week"`, defaulting to next week for compatibility. This week is computed in the host timezone and starts at the current time; past days remain empty. Both the image and its message identify the requested week. This week's image is informational and cannot confirm initial setup; the host still agrees to next week's current settings preview.

Calendar changes already rerun analysis and the setup instructions offer different suggested hours once, keeping the host's hours until they agree. This draft preserves that rule. Behavioral model evaluation and real-device acceptance remain necessary before release.
