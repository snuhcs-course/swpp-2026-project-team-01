# Spec Delta

## ADDED Requirements

### Requirement: Production-only page analytics
The web app SHALL load Google Analytics only when `GOOGLE_ANALYTICS_MEASUREMENT_ID` holds a GA4 measurement ID and the deployment is Vercel production. It SHALL record one page view for the first page and one for each later client-side navigation. Local runs, previews and tests SHALL NOT load it, and the Content Security Policy SHALL allow Google's tag and collection origins only when it is loaded.

#### Scenario: Production with a measurement ID
- **WHEN** a visitor opens `/` on a production deployment with the variable set
- **THEN** `gtag.js` loads and one page view for `/` is sent

#### Scenario: Local or preview
- **WHEN** the app runs locally, in a preview or in a test, or without the variable
- **THEN** no analytics script loads and the policy allows only the app's own origin for scripts and connections

### Requirement: Redacted page addresses
Analytics SHALL receive a page's path only, without its query string or fragment. A path of two or more segments SHALL be reported as its first segment followed by `/[redacted]`. The referrer SHALL be reduced to its origin. Google signals and ad personalization SHALL be off. No booking identifier, link code, OAuth parameter, email address, name or conversation text SHALL reach analytics.

#### Scenario: Booking link
- **WHEN** a requester opens `/booking/{id}`
- **THEN** analytics receives `/booking/[redacted]` and never the identifier

#### Scenario: Host page with a query string
- **WHEN** a visitor opens `/{handle}?lang=ko`
- **THEN** analytics receives `/{handle}` without the query

### Requirement: Disclosed in the data notice
The public data notice SHALL name Google Analytics among the providers, in English and Korean, and SHALL say that it receives redacted page paths, browser and device type and approximate location, that it sets cookies, how long Google keeps the data, and that it is not used for advertising.

#### Scenario: Visitor reads the notice
- **WHEN** a visitor opens `/privacy` or `/privacy?lang=ko`
- **THEN** Google Analytics is listed among the providers with what it receives
