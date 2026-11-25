# Proposal

Tracking issue: #327.

## Why

A host whose guest has no times because of the weekly limit receives a message that offers only changing the general setting. The web and MCP already offer request-specific weekly-limit and trip exceptions, but the linked messenger cannot use them in words. This leaves a guest waiting when the host could resolve the hold without changing their policy.

## What Changes

- Tell the linked host when every otherwise usable time is held by the weekly limit, naming the request and offering a one-request waiver in words.
- Let a host in a linked iMessage, Telegram or WhatsApp request discussion waive that request's weekly limit or allow minutes for one unresolved host trip using the same commands as the web and MCP.
- Report when the exception is recorded and when a fresh check has or has not found times; never imply a booking or a general setting change.
- Let the host send one explicit question from the linked conversation to the guest's web conversation and linked messenger, using a short notice headed "The meeting host asks about". Keep this feature marked in code for the team's later review.
- Keep the existing #122 decision: no notice when a request first arrives.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `host-imessage-channel`: notice and linked-conversation exception actions. Telegram and WhatsApp use the same host conversation behavior.

## Impact

`agent/tools/request.ts`, the host review tool adapter and instructions, host and guest notice copy, guest conversation rendering, relevant integration tests and [H03 testing baseline](../../../documentations/technical_specification/12_testing_baseline.md#h03-host-review-negotiation-and-decision). Existing conversation inputs and exception commands persist the actions; no database schema change is planned.
