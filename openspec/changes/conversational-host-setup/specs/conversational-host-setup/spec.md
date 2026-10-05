# Spec Delta

## Purpose

Let hosts complete and resume verified scheduling setup through website chat or a linked private iMessage conversation, using shared settings and readiness state.

## ADDED Requirements

### Requirement: Conversational website setup
The website SHALL make chat the primary host setup interface, accepting free-text preferences and providing accessible structured actions for choices, corrections, and required browser steps.

#### Scenario: Describe preferences
- **WHEN** an admitted host says they meet on weekday afternoons and need a buffer
- **THEN** the assistant extracts supported preferences, asks for unresolved times and buffer length, and shows a draft without claiming those settings are saved

#### Scenario: Accessible pending and failure states
- **WHEN** a host sends a message by keyboard on desktop or mobile
- **THEN** the interface exposes pending, success, or recoverable failure status, preserves unsent text on failure, and permits reading earlier messages without forced scrolling

### Requirement: Shared resumable setup
The service SHALL persist a host-owned setup conversation and versioned draft, and SHALL resume current progress across reloads, browser consent, and linked iMessage without repeating completed steps or exposing another host's conversation.

#### Scenario: Switch channels
- **WHEN** a verified linked host describes preferences in iMessage and later opens website setup
- **THEN** both surfaces show the same current draft and remaining setup actions

#### Scenario: Cross-account access
- **WHEN** another account requests a conversation identifier owned by a different host
- **THEN** neither transcript nor settings are disclosed or modified

### Requirement: Confirmed settings changes
Extracted preferences SHALL remain a draft until the host explicitly confirms a concrete current summary. Unsupported or ambiguous preferences SHALL trigger clarification. Stale confirmations SHALL not overwrite newer settings.

#### Scenario: Confirm current draft
- **WHEN** a host confirms a displayed summary with a unique handle, timezone, and valid scheduling rules
- **THEN** the existing setup guards validate and persist those exact settings and the conversation reports the server result

#### Scenario: Concurrent correction
- **WHEN** the host revises settings in one channel before confirming an older summary in another
- **THEN** the service rejects the stale confirmation and presents the current summary

#### Scenario: Model unavailable
- **WHEN** natural-language extraction fails or returns invalid data
- **THEN** confirmed settings remain unchanged and the host can retry or use structured setup controls

### Requirement: Verified browser handoffs
Setup chat SHALL direct hosts to verified browser steps for sign-in, invitation redemption, and Google authorization. It SHALL resume from validated server state after completion and SHALL not collect provider credentials or treat a chat message as consent.

#### Scenario: Unlinked iMessage entry
- **WHEN** an unknown sender requests host setup in a private iMessage conversation
- **THEN** the response provides a bounded verification continuation without revealing host records, admitting the sender, or connecting a calendar

#### Scenario: Denied or interrupted consent
- **WHEN** a host denies or interrupts Google consent
- **THEN** setup retains its draft and offers a safe resume action without claiming Calendar access

#### Scenario: Calendar selection
- **WHEN** consent succeeds and the host chooses conflict calendars and a booking calendar through the conversation
- **THEN** the server verifies actual calendar identifiers and current write permissions before saving the selection

### Requirement: Verified private iMessage identity
The service SHALL bind a private iMessage identity to an authenticated admitted host only after fresh proof of control of both sides. Group messages, forwarded challenges, expired challenges, and mismatched senders SHALL not authorize linking or setup access. Unlinking SHALL revoke subsequent channel authority.

#### Scenario: Successful link
- **WHEN** an admitted signed-in host completes a short-lived single-use challenge from the same private iMessage identity and explicitly confirms the link in that browser
- **THEN** future authenticated provider messages from that linked identity can access only that host's setup conversation

#### Scenario: Replayed or transferred challenge
- **WHEN** a consumed challenge is replayed or its private-conversation binding differs from the sender completing it
- **THEN** no new or replacement account link is created

#### Scenario: Unlinked queued message
- **WHEN** a previously linked identity is unlinked before a queued message is processed
- **THEN** the message cannot read private setup or mutate that host's settings

### Requirement: Reliable channel processing
The service SHALL process each inbound provider message once logically, preserve per-conversation order, recheck authority before mutation and outbound dispatch, and distinguish accepted, delivered, failed, and uncertain outbound states without blind resends.

#### Scenario: Duplicate inbound delivery
- **WHEN** Photon replays a message after a bridge restart
- **THEN** the saved operation result is reused without a second settings mutation or duplicate reply job

#### Scenario: Lost send response
- **WHEN** a reply dispatch loses its acknowledgement
- **THEN** its status remains uncertain until reconciled and no new message identifier is generated to resend it automatically

### Requirement: Honest completion and separate booking authority
Setup SHALL report readiness and share a booking link only when current admission, confirmed rules, timezone, handle, and writable calendar checks pass. Setup confirmation SHALL never authorize meeting approval or Calendar event creation.

#### Scenario: Ready host
- **WHEN** all existing setup readiness checks pass after the host confirms settings and calendar selections
- **THEN** either channel reports completion and provides the same public booking URL

#### Scenario: Missing permission or unrelated instruction
- **WHEN** calendar permission is missing or chat asks to bypass admission or book an event during setup
- **THEN** setup reports the relevant next action without bypassing guards or creating an event
