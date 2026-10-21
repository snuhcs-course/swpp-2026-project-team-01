## MODIFIED Requirements

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

#### Scenario: Environment-bound, audited operator action
- **WHEN** an operator suspends or restores a host through the administrator CLI
- **THEN** the command names exactly one target environment, requires explicit confirmation, and records the operator, action, host, reason, environment and time with the status change

### Requirement: Sign-up and handle abuse limits
The service SHALL bound host sign-up attempts and handle changes per account and per source, and SHALL reject reserved handles. A sign-up attempt is a completed Google sign-in that would create a host account for an identity that has none. At most 3 such accounts per source address and 100 service-wide SHALL be created in any rolling 24 hours. After a host's first handle assignment, at most 2 further handle assignments SHALL be accepted in any rolling 30 days.

#### Scenario: Excessive sign-up attempts
- **WHEN** sign-up attempts from one source exceed the bound
- **THEN** further attempts are temporarily rejected without affecting existing accounts

#### Scenario: Service-wide sign-up bound
- **WHEN** 100 host accounts were created in the last 24 hours and another new Google identity completes sign-in
- **THEN** no host account is created, no session remains, and the person sees a temporary-limit message

#### Scenario: Existing identity under a sign-up bound
- **WHEN** a source or the service is at its sign-up bound and an existing host signs in again
- **THEN** the existing host account is returned and the sign-in is not counted

#### Scenario: Excessive handle changes
- **WHEN** an account changes its handle more often than the bound allows
- **THEN** the change is rejected and the current handle is retained

#### Scenario: Reserved handle
- **WHEN** a host requests a reserved handle
- **THEN** setup rejects the handle without assigning it

## ADDED Requirements

### Requirement: Handle format and reserved names
A handle SHALL be 3 to 30 characters of lowercase letters, digits and single hyphens, SHALL start with a letter and SHALL NOT end with a hyphen. A proposed handle and a requested path SHALL be lower-cased before validation and lookup. Reserved names SHALL be rejected as handles and SHALL be resolved as routes before any handle lookup.

#### Scenario: Invalid format
- **WHEN** a host proposes a handle with a dot, a leading digit, a double hyphen, a trailing hyphen or fewer than 3 characters
- **THEN** the handle is rejected with the format rule and nothing is assigned

#### Scenario: Mixed case
- **WHEN** a host proposes `Alice` or a visitor opens `/Alice`
- **THEN** the handle is treated as `alice`

#### Scenario: Route name requested as a handle
- **WHEN** a host proposes `app`, `booking`, `auth`, `connect`, `connections`, `api` or `eve`
- **THEN** the handle is rejected as reserved and the route keeps serving its own page

#### Scenario: Released handle
- **WHEN** a host changes away from a handle and another host later proposes it
- **THEN** the proposal is rejected and the old handle returns the neutral unavailable result instead of resolving to anyone

### Requirement: Reserved handle list
The reserved handles SHALL be: about, account, accounts, admin, administrator, api, app, apple-icon, assets, auth, billing, blog, booking, bookings, cli, connect, connections, contact, dashboard, docs, email, eve, favicon, find-me-a-time, findmeatime, health, help, home, icon, inbox, internal, jobs, legal, llms, login, logout, mail, mcp, me, new, null, oauth, operator, pricing, privacy, public, robots, root, security, settings, sign-in, sign-out, sign-up, signin, signout, signup, sitemap, skill, static, status, support, system, team, terms, thyme, undefined, webhooks, well-known and www. A new top-level route SHALL be added to the list before it ships.

#### Scenario: Impersonation name
- **WHEN** a host proposes `support` or `findmeatime`
- **THEN** setup rejects the handle as reserved without assigning it
