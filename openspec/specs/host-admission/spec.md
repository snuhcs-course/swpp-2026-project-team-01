# host-admission Specification

## Purpose
Let anyone with a Google account become a calendar host through open sign-up, gate hosting on an active (not suspended) host account and completed setup, and keep requester journeys account-free. The capability name is retained from the earlier invite-only model.

## Requirements

### Requirement: Open host sign-up
Completing Google sign-in SHALL create exactly one active host account per Google identity without any waitlist, invitation, or approval step. Sign-in alone SHALL NOT publish a public booking profile.

#### Scenario: First sign-in
- **WHEN** a Google identity completes sign-in for the first time
- **THEN** one host account is created with status active and setup is available

#### Scenario: Repeated sign-in
- **WHEN** the same Google identity signs in again
- **THEN** the service returns the same host account with its saved setup and creates no duplicate

#### Scenario: Sign-in without setup
- **WHEN** a newly signed-in host has not completed setup
- **THEN** no public booking profile exists for that host

### Requirement: Operator suspension and restoration
Only an authorized operator, using separate operator authority, SHALL suspend or restore a host account. A suspended host SHALL be ineligible for hosting operations and SHALL NOT have a publicly available profile or booking documents.

#### Scenario: Suspended host operation rejected
- **WHEN** a suspended host calls setup, calendar connection, or another hosting operation
- **THEN** the operation is rejected without changing host data

#### Scenario: Public profile unavailable
- **WHEN** a requester opens the public profile or booking documents of a suspended host
- **THEN** the service returns a neutral unavailable result that discloses neither the suspension nor any existing requests

#### Scenario: Restoration
- **WHEN** an operator restores a suspended host account
- **THEN** hosting resumes with the saved setup and the public profile is available again if setup is complete

#### Scenario: Unauthorized suspension
- **WHEN** a requester or ordinary host attempts to suspend or restore an account
- **THEN** the service rejects the attempt without changing account status

### Requirement: Sign-up and handle abuse limits
The service SHALL bound host sign-up attempts and handle changes per account and per source, and SHALL reject reserved handles.

#### Scenario: Excessive sign-up attempts
- **WHEN** sign-up attempts from one source exceed the bound
- **THEN** further attempts are temporarily rejected without affecting existing accounts

#### Scenario: Excessive handle changes
- **WHEN** an account changes its handle more often than the bound allows
- **THEN** the change is rejected and the current handle is retained

#### Scenario: Reserved handle
- **WHEN** a host requests a reserved handle
- **THEN** setup rejects the handle without assigning it

### Requirement: Shared eligibility and readiness guards
Host setup, host calendar connection, and hosting operations SHALL require an active host account. Public booking profiles SHALL additionally require completed setup with confirmed rules, timezone, unique handle, and a valid writable booking destination.

#### Scenario: Direct bypass
- **WHEN** a signed-in account with incomplete setup, or a suspended account, calls hosting operations directly
- **THEN** the operation is rejected with the next required action

#### Scenario: Incomplete setup
- **WHEN** an active host has not selected a writable booking calendar or confirmed required settings
- **THEN** setup remains resumable and the host is not available for public requests

### Requirement: Stable public identity
Assigned host handles SHALL uniquely identify one stable host. An old public handle SHALL not silently resolve to a different host.

#### Scenario: Handle collision
- **WHEN** another host attempts to claim an assigned handle
- **THEN** setup rejects the collision without changing either identity

### Requirement: Requesters remain account-independent
Public requests and request-scoped requester Calendar consent SHALL remain available without a host account or a product account.

#### Scenario: Account-free requester
- **WHEN** a requester without any product account visits a ready host and starts intake or optional requester consent
- **THEN** neither operation requires a host account or product signup
