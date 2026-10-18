# Acceptance Inventory

Date: 2026-10-19

Status: **all implementation and acceptance evidence pending**

The [PRD](../02_product_requirements.md#9-end-to-end-release-acceptance-scenarios) owns full scenarios; this table maps every AC-01–AC-28 obligation to the [implementation plan](04_implementation_plan.md). Evidence is recorded only when a slice lands.

## AC-01–AC-28 obligations

| AC | Owning slices | Status | Required evidence |
|---|---|---|---|
| AC-01 | S4–S6 | Pending | Account-free clarification to one confirmed event; no missing-field assumptions |
| AC-02 | S5, S6 | Pending | Both travel legs, unknown/failed routes, explicit allowance, changed travel at dispatch and private projection |
| AC-03 | S5, S6 | Pending | Private host exception/revision, no rule leak or approval bypass |
| AC-04 | S4, S6, S9 | Pending | Material proposal edit invalidates old decisions and requires current agreement/approval |
| AC-05 | S7, S6 | Pending | Old email option cannot book or create a second request |
| AC-06 | S6, S9 | Pending | Concurrent mobile/agent decisions produce at most one event |
| AC-07 | S5, S6 | Pending | Competing requests and external busy change stop conflicting writes |
| AC-08 | S6 | Pending | Lost Calendar success response reconciles the existing event |
| AC-09 | S3–S6 | Pending | Revocation, definitive write rejection/retry and independent notification recovery |
| AC-10 | S1–S6, S9 | Pending | Private data/forged approval denial and attributable host confirmation |
| AC-11 | S7, S4 | Pending | Verified email-to-web same-request continuation; host/foreign privacy |
| AC-12 | S4–S6 | Pending | Same instant across DST; ambiguous/nonexistent local times clarified |
| AC-13 | S4, S6 | Pending | Closure/expiry denies late approval; uncertain-write withdrawal stays truthful |
| AC-14 | S9 | Pending | Both roles, privacy, current/stale decisions and retry in each of seven actual clients |
| AC-15 | S9, S4–S6 | Pending | Delegated account-free bootstrap/coordination and out-of-delegation clarification per client |
| AC-16 | S8, S6 | Pending | Real linked iMessage question/revision/current approval plus separate decline |
| AC-17 | S8 | Pending | Unlinked/group denial, ambiguous/stale replies and unlink revocation |
| AC-18 | S8, S6 | Pending | Restart/replay plus web race and independent delivery failure; one booking |
| AC-19 | S9, S2 | Pending | Actual host scoped consent, denial, revocation and continued web review |
| AC-20 | S9 | Pending | Expired/wrong-resource/Calendar tokens denied; OAuth grants create no approval |
| AC-21 | S9, S4 | Pending | One-request account-free continuation and foreign/host-action denial |
| AC-22 | S9, S6 | Pending | Full same-request MCP/user CLI JSON/version/retry parity and setup recovery |
| AC-23 | S9, S2, S3 | Pending | Root skill prompt: new/invited/existing/interrupted hosts in every actual client |
| AC-24 | S9, S4–S6 | Pending | Per-host skill prompt with full/missing context, pending approval and truthful confirmation |
| AC-25 | S9 | Pending | Unavailable/unknown skill or host, fetch/connect failure and denied-consent safe fallback |
| AC-26 | S2, S3, S9 | Pending | Deduplicated waitlist, unusable/concurrent invites and web/API/MCP/CLI admission guards |
| AC-27 | S4–S6 | Pending | Uninvited requester optional Calendar, denial/revoke/failure/manual replacement and request isolation |
| AC-28 | S2, S3, S8 | Pending | Full suggestion-first setup, failed/sparse data, explicit mode/travel, current review and accessible inline linking/skip |

## Named clients

Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code each require independent versions and both-role journeys for AC-14/15/19/20/23/24/25. Client availability and compatibility are all pending. A working MCP SDK fixture, repository CLI or other product does not close a named-client row.

## Recording evidence

After implementation starts, attach fresh test references, controlled provider/device/client results, source revision, command/date, environment, versions and gaps. Fixtures cannot establish inbox/device delivery or live consent. An unresolved required client or provider case remains a release blocker, with its exact prerequisite identified.

Cross-cutting runtime protection, model limits, accessibility, durable effects, consumer fencing and populated restoration require evidence beyond these product IDs. Keep them in the owning slice's verification record. This inventory is a coverage map, not a release sign-off.
