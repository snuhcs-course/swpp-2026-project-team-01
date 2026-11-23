# Design

## 1. Scope and renderer

All transactional templates use English copy. Request creation and link resend use the shared ink-blue renderer in `lib/server/email-templates.ts`; booking and account templates retain their existing specialized layouts, data and delivery behavior while their user-facing prose, headings, subjects and action labels are revised for clarity.

The request creation transaction keeps storing the guest's chosen language for the booking page and conversation. `renderEmail()` uses English for every transactional email, without changing the booking page, conversation or generated email-thread reply language.

## 2. Visual direction

Use the tokens from `DESIGN.md`: paper `#F6F7F9`, white surface `#FFFFFF`, ink `#1E2430`, body copy `#3E444E`, muted copy `#586172`, hairline `#D4D9E2`, and primary ink blue `#2C3E63` with white action text. Keep a centered, fluid 600px-wide reading surface, generous spacing, a live-text `Find Me a Time` wordmark, a clear subject heading and one prominent booking action. Use system sans-serif for copy and a Georgia serif fallback for the wordmark; do not depend on remote fonts, images or CSS.

The unverified-address section is visually separated on a pale-paper surface, with a secondary outlined blue action. Its copy says the step is optional and does not pause scheduling. The booking link remains the only primary filled button. Other email renderers retain their existing design so this change focuses on writing and accurate call-to-action labels across those flows.

## 3. Email-client implementation

Use nested presentation tables and inline styles so the email remains legible in clients with limited CSS support. Set `lang="en"`, UTF-8, a viewport, table widths, padding, color and font fallbacks in the generated markup. Keep the text alternative in the same content order. Continue escaping all dynamic copy and URLs with `escapeHtml`; do not log or store the usable booking or confirmation URLs beyond the existing sealed-delivery path.

## 4. Decisions and trade-offs

- Apply English consistently to transactional email templates, following the user's request to use English across the email experience. In-product content remains localized.
- Use inline, table-based HTML instead of adding an email-rendering dependency; this keeps the change within the current server renderer and avoids external assets.
- Keep email confirmation distinct from booking access because it proves control of an address while the booking link is required to continue the request.

