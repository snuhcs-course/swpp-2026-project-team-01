# Design

## Context

See the [proposal](proposal.md) and [host-settings contract](specs/host-settings/spec.md). `/app` has a shared `WorkspaceMenu` in `SetupWorkspace` and `HostRequests`; it already signs out through `/auth/sign-out`. `WeeklyWindowsEditor` edits the setup draft, while `setup.confirm_settings` copies reviewed values into the confirmed policy. `readReadiness` derives technical readiness from account, calendar, handle and confirmed settings. `findReadyHostByHandle` and `hostAcceptsRequests` gate public entry; the latter currently checks readiness both when starting a draft and when identifying it.

## Goals / Non-Goals

**Goals:** One accessible settings surface in host conversations, a revision-safe path from window edits to confirmed policy, and a durable host preference that gates only new request intake across channels.

**Non-Goals:** Replace the request inbox or setup conversation, turn pause into account suspension, cancel existing requests, edit one-off exceptions, change meeting feasibility rules, or make a separate settings route.

## Decisions

### 1. Mount one dialog in the shared host header

Use a shared gear trigger and dialog component from both setup and request views, immediately left of the existing navigation menu. The menu is the rightmost header action and continues to own Setup, Requests, iMessage, Connected agents and **Sign out**. Use the existing accessible dialog primitive: translucent backdrop, elevated clean-surface panel, explicit title and an upper-right **X**. The panel stays opaque enough for the ink text and controls to meet `DESIGN.md` contrast rules. On open, focus the title or first control; on close, restore focus to the gear and retain the underlying conversation and scroll position. Escape closes. If window edits are unsaved, ask whether to discard before X or Escape closes. A separate `/settings` page would lose conversation context, so it is rejected.

### 2. Reuse setup's draft and confirmation path for windows

The dialog reads the current setup state, displays confirmed weekly windows in the confirmed timezone and flags any pending draft. Reuse `WeeklyWindowsEditor` for weekday rows and overnight labels, but send edits through the existing `setup.update_draft` command with the current revision. The dialog then shows a concise before/after review and calls `setup.confirm_settings`, including the normal readiness checks. For an incomplete host, it may save the draft, then link back to the next required setup step; no public schedule is implied. A ready host's old confirmed windows remain live until confirmation succeeds. A direct write to `host_settings` from the dialog would bypass the review and role checks, so it is rejected.

### 3. Persist intake preference separately from readiness

Add `accepting_requests boolean not null default true` and a monotonic `intake_revision` to `app.host_accounts`, separate from its operator-controlled status. Existing hosts default to true, preserving current admission after migration. A host-authenticated, active-account command changes only that preference with an expected revision and retry key. The response returns both the saved preference and effective intake state (`ready && accepting_requests`), so lost readiness cannot be mistaken for an enabled public page. A suspended host cannot change it. The UI shows **Paused** or **Accepting** for ready hosts and a separate setup/calendar reason when readiness is missing.

Every public discovery path (`/{handle}`, its skill document, requester MCP and email entry) checks the effective state. The transactional creation guard locks the account/preference row while it checks the toggle so turning off intake and a concurrent creation have one clear order. `request.start` and other *new* creation paths use this guard. `request.identify` for an existing draft and all existing-request commands continue to use their normal host eligibility and request checks without the new intake preference. This distinction is necessary because the present `hostAcceptsRequests` helper is also called during draft identification. Reusing account suspension would incorrectly block existing requests and operator semantics, so it is rejected.

### 4. Keep toggles and window edits independent

The toggle saves immediately and visibly; window edits need explicit review and confirmation. Closing the modal discards only unsubmitted window form input, not a successfully saved toggle or setup draft. On a stale toggle or draft revision, reload authoritative state and show what changed rather than overwriting it. The gear panel always labels pending windows and saved intake state separately to avoid implying both share a save button.

## Risks / Trade-offs

- **Public entry paths can disagree during a pause** → route all web, email, agent and document discovery through one effective-intake check, then verify concurrent creation and toggle ordering.
- **A draft guest may be stranded by pause** → preserve draft identification and all existing-request continuation; gate only creation of a new request.
- **A ready host may lose Calendar access after enabling intake** → show effective unavailable status from the server and keep the saved preference distinct; it cannot override readiness.
- **The new dialog overlaps issue #43's theme migration** → use its shared ink tokens and verify modal contrast after integration rather than introducing modal-only colors.
- **An unconfirmed window edit may look live** → show confirmed and pending values separately and require the existing confirmation action.

## Migration Plan

Add the default-on preference and revision in the declarative schema, generate and review a migration, and verify a local reset before any shared deployment. Land the gate and dialog together so the toggle never appears before all new-request entry paths obey it. Rollback removes the control and restores the prior default-on behavior while leaving existing request records untouched. Deploy the migration to the shared project only through the repository's reviewed migration workflow; document the resulting state in the acceptance record.
