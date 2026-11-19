# Design: request accordion prototype

## Interaction

Keep the current Requests heading, direction filters, and collapsed summary. Make each summary a button with `aria-expanded` and an associated details region. One card is open at a time. The filled prototype starts with the first card expanded so the detail design is immediately visible; production default state should be decided after review.

The expanded detail stays inside the card boundary. A divider separates the summary from the meeting details. The current state leads, followed by a prominent date and time band. Compact labeled facts carry the remaining fields. The action row follows the facts at the bottom. On narrow screens, facts use two columns and action buttons stack to preserve readable labels and touch targets. The proposal version is omitted from visible copy; it remains available to the approval command so the action still names the exact version.

The sample data has the current `WorkspaceRequestItem` state and decision fields and the detailed `HostRequestView` proposal fields. The prototype's copy branches use `state`, `needsDecision` and `proposal.agreedAt`. A closed request is labeled closed in the expanded view, avoiding the current card's misleading "Waiting for the requester" fallback on a withdrawn request. The prototype shows the same proposal action labels but sends no commands. It proposes clearer statuses (**Coordinating a time**, **Request withdrawn**, **Meeting cancelled**, **Awaiting host approval**) and softer proposal descriptions for review.

## Source and constraints

The palette, type direction and 720px Requests column follow [DESIGN.md](../../../DESIGN.md). The sample fields and button availability follow the current list projection, `HostRequestView`, and `ProposalReviewCard` in `apps/web/app/_components/host/host-request-cards.tsx`. In production, the list reads `/api/host/workspace-requests` and the details read `/api/host/requests/{requestId}`. The date-led details and compact metadata take cues from cal.diy's `BookingDetailsSheet.tsx` at revision `ae027bb70e694e2d2c44569f398d6cbcee0389b1`; its sheet navigation and data architecture are not adopted.

The current chat-workspaces spec requires the host conversation first. That contract must be revised when the design is approved, before production implementation. The request dashboard change also defines received and sent list behavior; its sent request navigation needs an explicit decision if the entire Requests page becomes accordion-only.

## Review points

- Does the highlighted `When` row make the proposed time easier to scan than the original detail list?
- Should the first card start open, or should every card begin collapsed?
- Should received requests without a proposal and closed requests use this same expanded layout?
- Does the sent-request path stay as it is, or should it also expand in the list?
