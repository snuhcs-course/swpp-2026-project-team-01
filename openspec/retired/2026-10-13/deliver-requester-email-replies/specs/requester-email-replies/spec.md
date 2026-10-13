# Spec Delta

## Purpose

Deliver private answers to authorized requester email inputs with durable identity and safe continuation across lost responses and worker restarts.

## ADDED Requirements

### Requirement: Atomic immutable reply
Runtime completion for an authorized email input SHALL save at most one private reply in the same transaction. It SHALL freeze the current bound recipient, inbox, receiver, link, thread, parent and content. Replayed completion SHALL not replace that answer. Failed generation SHALL use a bounded browser-continuation fallback without claiming scheduling success.

#### Scenario: Settlement response lost
- **WHEN** completion is retried with different generated text after the first completion committed
- **THEN** the original answer and dispatch identity remain unchanged

#### Scenario: Authority revoked before completion
- **WHEN** linking authority is no longer current at settlement
- **THEN** completion records a suppressed outcome without queuing private content for sending

### Requirement: Fenced bounded delivery recovery
Workers SHALL recheck current authority and lease ownership immediately before network dispatch. They SHALL preserve immutable send identity through uncertainty and retry only within 23 hours of the persisted first attempt. An expired horizon SHALL preserve uncertainty without sending. An earlier uncertain reply SHALL hold later replies in that linked thread.

#### Scenario: Crash after provider acceptance
- **WHEN** the provider accepted a reply but its acknowledgment was lost
- **THEN** recovery uses the same idempotency key and payload within the horizon, with no new logical reply

#### Scenario: Lease or access lost
- **WHEN** a worker's lease expires, its receiver is replaced or the request is revoked before dispatch
- **THEN** it cannot send or overwrite the outcome using that stale lease

#### Scenario: Recovery window expires
- **WHEN** acceptance remains unknown after the retry horizon
- **THEN** no additional send is attempted and later replies remain held until uncertainty is resolved

### Requirement: Evidence-based outgoing continuation
A signed requester continuation SHALL also be allowed to reference an accepted service reply from the same current link, receiver, inbox and thread. That reply SHALL derive from an earlier authorized input and its first dispatch SHALL precede receipt of the continuation. Unsent, uncertain or unrelated outgoing identities SHALL not establish authority.

#### Scenario: Normal client reply
- **WHEN** the bound author replies with authenticated recipient and parent headers to an accepted service answer
- **THEN** the continuation can run with the same current request authority

#### Scenario: Unrelated parent
- **WHEN** a message cites another request's outgoing answer or a reply without provider acceptance evidence
- **THEN** it cannot acquire request authority despite provider thread grouping

### Requirement: Private acceptance evidence
Reply payloads, lease credentials and provider evidence SHALL be restricted to internal delivery operations. Provider acceptance SHALL not claim inbox delivery, contact verification, requester agreement, host approval or booking completion.

#### Scenario: Provider accepts reply
- **WHEN** the intended reply receives valid provider message and thread identities
- **THEN** the application records acceptance only and leaves scheduling decisions unchanged
