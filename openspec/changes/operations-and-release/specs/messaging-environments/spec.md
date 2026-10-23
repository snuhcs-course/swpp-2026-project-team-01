## ADDED Requirements

### Requirement: Staging production denial
A Vercel production deployment whose configured canonical origin is set and is not a release origin SHALL be treated as staging and SHALL be denied messaging as a preview is, before provider network access or delivery-state reads. The release origins are `https://findmeatime.com` and `https://release.findmeatime.com`.

#### Scenario: Staging deployment with provider credentials
- **WHEN** the staging project's production deployment, served on another origin, attempts email or iMessage delivery
- **THEN** no provider request is sent and the caller receives configuration unavailability

#### Scenario: Release deployment
- **WHEN** a production deployment's canonical origin is a release origin or is unset
- **THEN** messaging admission is unchanged
