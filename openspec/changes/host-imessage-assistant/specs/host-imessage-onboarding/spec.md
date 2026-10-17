# Spec Delta

## Purpose

Enable an authenticated host to connect a phone number to their account through a Photon iMessage welcome conversation, with durable delivery status and trustworthy inbound identification before any future scheduling actions are enabled.

## ADDED Requirements

### Requirement: Authenticated host starts phone connection

The system MUST let a host with a real authenticated session submit one valid E.164 phone number for a host iMessage connection and MUST return a connection status that can be used by a future onboarding UI. A demo identity or an unauthenticated request MUST NOT initiate a real message.

#### Scenario: Text me creates a pending connection

- **WHEN** an authenticated host submits a valid, available phone number
- **THEN** the system records a pending connection for that host and schedules one welcome message for that number
- **AND** it returns the connection identifier and status without exposing another host's data

#### Scenario: Invalid or unavailable number

- **WHEN** the number is invalid, already pending or connected for another host, or the caller is not authenticated in real mode
- **THEN** the system rejects the request without sending a message or disclosing the other host's identity

#### Scenario: Repeated Text me request

- **WHEN** the same host repeats the same request for an existing pending or connected number
- **THEN** the system returns the existing connection state and does not schedule a second welcome message

#### Scenario: Start onboarding without the new UI

- **WHEN** an authenticated real-mode host calls the connection API directly with an available test phone number before the onboarding UI exists
- **THEN** the system schedules the same welcome message and exposes the same host-owned status that the future `Text me` UI will use

### Requirement: Send welcome through Photon

The system MUST send an English host onboarding welcome through Photon to the submitted number. The message MUST identify Find Me a Time and MUST ask the recipient to reply; that reply is used to establish the phone connection. An accepted outbound send MUST NOT by itself mark the number as connected.

#### Scenario: Welcome explains the next action

- **WHEN** the welcome message is composed
- **THEN** it welcomes the recipient to Find Me a Time in English
- **AND** it asks the recipient to reply without promising that a booking has been created

#### Scenario: Welcome accepted by Photon

- **WHEN** Photon accepts the queued welcome send
- **THEN** the connection status becomes sent or awaiting reply
- **AND** the associated Photon conversation and sender line are retained for matching the host's reply

#### Scenario: Welcome cannot be sent

- **WHEN** Photon definitively rejects or fails the welcome send
- **THEN** the attempt and safe failure status are recorded and the connection is not marked connected

### Requirement: Report failure and allow controlled retry

The system MUST expose the host's own connection status and MUST permit a bounded retry of a failed welcome send without creating another phone connection. A send with an uncertain outcome MUST NOT be automatically retried as if it had definitely failed.

#### Scenario: Host retries a failed send

- **WHEN** the authenticated owner requests retry of an eligible failed send
- **THEN** one new attempt is scheduled for the same connection, subject to the retry limit

#### Scenario: Retry is not eligible

- **WHEN** the connection is already sent or connected, has exhausted its retry limit, or has an uncertain send outcome
- **THEN** the system does not send another welcome message

### Requirement: Authenticate and store inbound Photon events

The system MUST verify each Photon webhook before using it, persist supported inbound events durably, and process each provider message identifier at most once despite duplicate deliveries. It MUST acknowledge a delivery only after its durable receipt or dedupe decision is recorded.

#### Scenario: Valid inbound message

- **WHEN** a correctly signed, recent Photon iMessage delivery arrives with a new message identifier
- **THEN** the system records the message identifier, conversation, sender, content type, and receipt state once
- **AND** it acknowledges the delivery after the record is durable

#### Scenario: Invalid or repeated delivery

- **WHEN** signature verification fails, the timestamp is stale, or required routing fields are invalid
- **THEN** the system does not use the payload to identify a host or change account state
- **WHEN** a valid delivery repeats an already recorded message identifier
- **THEN** the system acknowledges it without applying the event again

#### Scenario: Temporary persistence failure

- **WHEN** a valid delivery cannot be durably recorded
- **THEN** the system returns a retryable failure rather than acknowledging it as processed

### Requirement: Retain matched host conversation history

The system MUST retain the text, direction, provider or local message identifier, timestamp, and Photon conversation identifier for messages exchanged with a uniquely matched host connection. It MUST associate that history with the host account and MUST NOT retain the body of an unmatched sender's message as host conversation history. This history MUST NOT by itself authorize a booking change.

#### Scenario: Connected host sends a text

- **WHEN** a verified inbound text matches a connected host and conversation
- **THEN** the system stores the text once in that host's conversation history with its message identifier and time

#### Scenario: Welcome message is sent

- **WHEN** a welcome send is accepted by Photon for a pending host connection
- **THEN** the system records that outbound text in the same host-scoped conversation history without duplicating it on retry

#### Scenario: Unknown sender sends a text

- **WHEN** a verified inbound text has no unique host connection match
- **THEN** its body is not retained as host conversation history or exposed to a host account

### Requirement: Connect only a matching host reply

The system MUST connect an unverified phone number only after a verified inbound text reply from the same normalized sender in the same one-to-one Photon conversation and sender line, before the connection attempt expires. This also applies when the send acknowledgement was uncertain. Messages from unknown, mismatched, group, or already disconnected conversations MUST NOT authorize a host or alter a booking.

#### Scenario: Host replies in the welcome conversation

- **WHEN** a verified inbound text comes from the unverified number in its recorded one-to-one welcome conversation before expiry
- **THEN** the connection becomes connected for that host exactly once
- **AND** subsequent messages in that conversation can be attributed to the connected host

#### Scenario: Observe completion without the new UI

- **WHEN** an authenticated host receives the welcome on an authorized test phone, replies in the same conversation, and requests their connection status directly
- **THEN** the status reports `connected` after the verified reply is processed

#### Scenario: Sender or conversation does not match

- **WHEN** a verified inbound event has no unique pending or connected host match, arrives in a different conversation or line, or is not text
- **THEN** it remains untrusted for host actions and does not connect a phone number

### Requirement: Preserve current guest and booking boundaries

The system MUST leave guest request creation on the existing web and invite-link flow and MUST NOT execute a booking accept, decline, or other request mutation from an inbound iMessage in this change.

#### Scenario: Message mentions a booking decision

- **WHEN** any inbound message says to accept or decline a request
- **THEN** no booking command is run from that message
- **AND** existing web authorization and booking rules remain the only way to change the request
