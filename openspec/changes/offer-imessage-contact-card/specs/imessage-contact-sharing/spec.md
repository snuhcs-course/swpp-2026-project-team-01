# Spec Delta

## Purpose

Let verified linked hosts optionally request the service account's native iMessage contact card while preserving recipient choice, current authority and truthful delivery uncertainty.

## ADDED Requirements

### Requirement: Explicit optional contact request
The service SHALL offer an accessible optional Add to contacts action only to an authenticated admitted host with a current verified private iMessage link. It SHALL explain that a card is requested in the linked conversation and saving remains the recipient's choice. Linking, model text and contact saving SHALL NOT constitute this request or grant notification, scheduling or booking authority.

#### Scenario: Newly linked host
- **WHEN** the host completes linking without choosing Add to contacts
- **THEN** no contact card is dispatched and web setup can continue

#### Scenario: Host chooses contact sharing
- **WHEN** the linked host explicitly selects Add to contacts
- **THEN** a durable request is accepted for that verified conversation and the interface explains the separate recipient-controlled save step

#### Scenario: Unauthorized or forged action
- **WHEN** a guest, unadmitted host, cross-origin caller or another host supplies a link identifier
- **THEN** no contact request or provider operation is created and no private link details are disclosed

### Requirement: Verified route and current authority
Contact sharing SHALL use the native service-account card on the current verified link's saved project, sender route and private recipient. The service SHALL recheck current link, host/session authority and enabled receiver immediately before dispatch. It SHALL NOT substitute an arbitrary recipient, group chat or global shared-pool phone number.

#### Scenario: Shared route
- **WHEN** the verified link uses a shared provider pool
- **THEN** sharing uses that saved private conversation route without inventing a global sender phone or claiming a verified display name

#### Scenario: Revoked before dispatch
- **WHEN** the link is replaced or revoked, the initiating session/admission expires, or its receiver is disabled before dispatch
- **THEN** queued work cannot send a contact card under the earlier authority

### Requirement: Durable single dispatch and uncertain recovery
The service SHALL persist one logical contact-sharing intent per verified link before external dispatch. Duplicate requests, concurrent clicks, lost responses and recovery SHALL reuse that intent. Work not yet dispatched SHALL be recoverable under bounded current ownership. Once dispatch may have occurred, missing acknowledgement SHALL remain uncertain and SHALL NOT trigger another native share.

#### Scenario: Lost acceptance response
- **WHEN** request creation commits but the browser loses its response and retries or reloads
- **THEN** it observes the existing intent without creating another dispatch

#### Scenario: Lost wakeup or expired pre-dispatch lease
- **WHEN** a queued request loses its immediate wakeup or worker before dispatch
- **THEN** recurring recovery can claim it under current authority and bounded retry limits

#### Scenario: Worker stops around provider dispatch
- **WHEN** the worker stops after recording dispatch permission, including before calling the provider or before recording its acknowledgement
- **THEN** recovery preserves uncertainty and does not send again

#### Scenario: Stale completion
- **WHEN** an expired or replaced worker records acceptance
- **THEN** its stale ownership cannot overwrite the persisted current outcome

### Requirement: Honest private status and environment isolation
Browser and operational views SHALL distinguish queued, accepted, failed, revoked and uncertain outcomes without exposing provider credentials or raw errors. Acceptance SHALL mean provider acknowledgement only, not device delivery, import or displayed name. Non-production deployment guards SHALL deny contact sharing before claiming work or accessing the provider.

#### Scenario: Acknowledged share
- **WHEN** the provider acknowledges the native sharing operation
- **THEN** the host is told to check iMessage and choose whether to save; the service does not claim that saving or delivery completed

#### Scenario: Ambiguous share
- **WHEN** native sharing loses its result
- **THEN** the host sees an uncertain state, can refresh status and check the existing conversation, and is not offered a blind resend

#### Scenario: Preview with inherited credentials
- **WHEN** a non-production Vercel deployment invokes the worker or transport with otherwise valid credentials
- **THEN** it makes no provider request and consumes no delivery state
