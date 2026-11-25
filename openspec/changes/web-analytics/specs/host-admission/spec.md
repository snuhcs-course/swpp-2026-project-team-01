# Spec Delta

## MODIFIED Requirements

### Requirement: Reserved handle list
The reserved handles SHALL be: about, account, accounts, admin, administrator, api, app, apple-icon, assets, auth, billing, blog, booking, bookings, cli, connect, connections, contact, dashboard, docs, email, eve, favicon, find-me-a-time, findmeatime, health, help, home, icon, inbox, ingest, internal, jobs, legal, llms, login, logout, mail, mcp, me, new, null, oauth, operator, pricing, privacy, privacy-policy, public, robots, root, security, settings, sign-in, sign-out, sign-up, signin, signout, signup, sitemap, skill, static, status, support, system, team, terms, terms-of-service, thyme, undefined, webhooks, well-known and www. A new top-level route SHALL be added to the list before it ships.

#### Scenario: Impersonation name
- **WHEN** a host proposes `support` or `findmeatime`
- **THEN** setup rejects the handle as reserved without assigning it

#### Scenario: Analytics relay
- **WHEN** a host proposes `ingest`
- **THEN** setup rejects the handle as reserved, because `/ingest` relays analytics to PostHog
