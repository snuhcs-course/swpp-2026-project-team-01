# Spec Delta

## ADDED Requirements

### Requirement: Production-only product analytics
The web app SHALL load PostHog only when `POSTHOG_PROJECT_KEY` holds a PostHog project key and the deployment is Vercel production, and the server and the agent SHALL send events only under the same condition. The browser SHALL send events to the app's own `/ingest` path, and the Content Security Policy SHALL NOT name PostHog. Local runs, previews and tests SHALL send nothing.

#### Scenario: Production with a project key
- **WHEN** a visitor opens `/` on a production deployment with the key set
- **THEN** PostHog loads from the app's origin and a page view for `/` is sent through `/ingest`

#### Scenario: Local or preview
- **WHEN** the app runs locally, in a preview or in a test, or without the key
- **THEN** no analytics code loads, `/ingest` is not rewritten and the server sends no event

### Requirement: Redacted addresses
Every analytics event, session replay snapshots and exception messages included, SHALL carry addresses with the path only, without a query string or fragment. A path on the app's origin of two or more segments SHALL be reported as its first segment followed by `/[redacted]`, except built assets under `/_next/`. A referrer SHALL be reduced to its origin. No booking identifier, link code or OAuth parameter SHALL reach analytics.

#### Scenario: Booking link
- **WHEN** a requester opens `/booking/{id}`
- **THEN** analytics receives `/booking/[redacted]` in the page view, in click and heatmap events and in the recording, and never the identifier

#### Scenario: Host page with a query string
- **WHEN** a visitor opens `/{handle}?lang=ko`
- **THEN** analytics receives `/{handle}` without the query

### Requirement: Masked recordings and clicks
Session replay SHALL mask all text, every input and descriptive attributes such as labels and titles, and SHALL block images, video and canvas. Click events SHALL describe the element without its text or attributes. No conversation text, guest name, email address or calendar detail SHALL reach analytics from the browser.

#### Scenario: Host reviews a request
- **WHEN** a host opens a request with a guest's name and message and clicks on it
- **THEN** the recording shows the layout with the text masked, and the click event names the element without the guest's name

### Requirement: Identified hosts, anonymous guests
A signed-in host SHALL be identified by their host account ID, with their handle, sign-up date, linked channel, calendar status and setup readiness as person properties and no name or email. Signing out SHALL reset the identity. Guests SHALL NOT be identified and SHALL get no person profile.

#### Scenario: Host signs in and out
- **WHEN** a host opens `/app` and later signs out
- **THEN** analytics links their events to their host account ID, and after signing out the browser's events are anonymous again

### Requirement: Server events without content
The command pipeline SHALL send each committed command by its operation name and each failure with its category, the job worker each job's kind and result, the channel receivers each stored message's channel and content type, and the agent each session start, turn end and tool call by name. A host's events SHALL be attributed to their host account ID; anyone else's to a hashed pseudonym without a person profile. No message text, phone number, email address, name, calendar or resource identifier SHALL be sent, and a failure to send SHALL NOT change the result.

#### Scenario: Guest message on Telegram
- **WHEN** a Telegram message is stored
- **THEN** analytics receives `channel_message_received` with channel `telegram` and its content type, and never its text or sender

#### Scenario: Analytics unreachable
- **WHEN** PostHog cannot be reached while a host approves a request
- **THEN** the approval commits and answers as it would without analytics

### Requirement: Disclosed in the data notice
The public data notice SHALL name PostHog among the providers, in English and Korean, and SHALL say what it receives from the browser and from the server, that recordings hide text, inputs and images, that it sets cookies and local storage, that signed-in hosts are linked to their account, where the data is stored and how long it is kept.

#### Scenario: Visitor reads the notice
- **WHEN** a visitor opens `/privacy` or `/privacy?lang=ko`
- **THEN** PostHog is listed among the providers with what it receives, and Google Analytics is not
