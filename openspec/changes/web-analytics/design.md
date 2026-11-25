# Design

## Context

See [proposal.md](proposal.md). The root layout (`apps/web/app/layout.tsx`) is a server component shared by every page. `apps/web/next.config.ts` sends one static Content Security Policy: scripts, connections and images come only from the app's own origin. Credentials sit in paths: `/booking/{id}`, `/connect/link/{code}`, `/connections/google/...`, `/imessage/continue`, `/auth/callback` and `/oauth/...` with query values. `cacheComponents` is on, so the layout is prerendered and reads environment variables at build time. Every mutation runs through `runCommand` (`lib/server/commands.ts`), every job through `runWorkerBatch` (`lib/server/job-worker.ts`), every iMessage, WhatsApp and Telegram message through `storeReceipt` (`lib/server/photon-receiver.ts`) and every email through the AgentMail receiver; eve hooks see every session, turn and tool result.

## Decisions

### D1. PostHog in the browser and on the server

The browser runs `posthog-js`, imported inside an effect of a client component, `<Analytics config>`, which the root layout renders only when analytics is on, so other builds never ship it. The server runs `posthog-node` from `lib/server/product-analytics.ts`, shared by the web app, the job worker and the agent. One tool covers the web funnel, the agent and the channels, where Google Analytics covered page views only.

Rejected: Google Analytics 4 (the #343 tag) | it sees the web app only, and its funnels, replay and server events need other products. Rejected: `@posthog/next` or the PostHog provider pattern | a provider wrapping the tree would put the SDK in every build; an effect-only component keeps it out when the key is unset.

### D2. Report paths, not addresses

`analyticsPath(pathname)` keeps `/` and single-segment paths, which are public (`/app`, `/privacy`, a host's handle), and cuts every longer path to `/{first}/[redacted]`. `analyticsUrl` applies it to an address on the app's origin, drops the query and fragment, reduces another origin's address to its origin, and keeps built assets (`/_next/...`), which hold no credential and which replay needs for styles. No other dotted path is kept: a connect-link token is dotted base64url and an email address ends in a domain. `redactAnalyticsValue` runs in `before_send` over the whole event: every property named like an address (`$current_url`, `$pathname`, `$referrer` and their `$initial_`, `$session_entry_` and `$prev_` forms, `href`, `src`, `action`), the `href`, `src` and `action` attributes in `$elements_chain`, heatmap keys, and session replay snapshots, which are sent uncompressed so they can be walked. Every other string, such as an exception's message or a stack frame's file, passes `analyticsText`, which redacts any address on the app's origin and any path under `/api`, `/auth`, `/booking`, `/connect`, `/connections`, `/imessage` or `/oauth` wherever it appears. Feature flags are off (`advanced_disable_flags`), since their request does not pass `before_send`. Replay's captured network requests are redacted by the same function. Campaign parameters survive as PostHog's own `$utm_*` properties.

Rejected: an allowlist of public routes | every new route would be unmeasured until someone added it, and a host handle is not a fixed route. Rejected: redacting only `$current_url` | PostHog repeats the address in a dozen properties, heatmap keys and replay.

### D3. Production only and opt-in

`analyticsConfig(env)` in the web app returns the key and region only when `POSTHOG_PROJECT_KEY` matches `^phc_[A-Za-z0-9]+$`, `POSTHOG_REGION` is unset, `us` or `eu`, and both `VERCEL=1` and `VERCEL_ENV=production` hold. `next.config.ts` cannot import local modules, so it repeats the check to decide whether to add the relay, and a unit test keeps the two in step. The server's `serverAnalyticsConfig` reads production as `lib/server/deployment.ts` does, custom targets included. Staging (`dev.findmeatime.com`) stays unmeasured until its Vercel project sets a key of its own.

### D4. Disclosure, not a banner

PostHog sets first-party `ph_*` cookies and local storage and receives the visitor's IP address, which it uses for coarse location. The notice names PostHog, what it receives in the browser and from the server, that replay hides text, inputs and images, that signed-in hosts are identified by their account, the region and the retention. There is no consent banner, the same basis as operations-and-release D12. A release that targets EU visitors needs PostHog's cookieless mode or a banner first.

### D5. Same-origin relay

The browser's `api_host` is `/ingest`. `next.config.ts` rewrites `/ingest/static/:path*` to `https://{region}-assets.i.posthog.com/static/:path*` and `/ingest/:path*` to `https://{region}.i.posthog.com/:path*`, only when analytics is on. The SDK's lazily loaded scripts (replay, web vitals, dead clicks, exceptions) and its requests therefore stay on `'self'`, and the Content Security Policy is unchanged. `/ingest/array/:path*` (the project's remote configuration) goes to the assets host too. PostHog's endpoints end in a slash, so `skipTrailingSlashRedirect` is on with analytics, and a `redirects()` entry sends every other path with a trailing slash to its path without it, as Next.js did, the routes the proxy skips included. The proxy's matcher skips `/ingest`, so analytics requests never touch the Supabase session. `ingest` is a reserved handle, so no host page can sit under the relay.

Rejected: listing PostHog's origins in the CSP | it widens `script-src` to a third party, and ad blockers drop requests to PostHog's hosts.

### D6. Capture everything, show nothing

On: autocapture, page views on history changes, page leaves, rage clicks, dead clicks, heatmaps, web vitals, network timing, exception autocapture and session replay. Replay masks every input, all text (`maskTextSelector: "*"`) and descriptive attributes (`aria-*`, `title`, `alt`, `placeholder`, `value`, `label`, `content`, `data-*`), and blocks `img`, `video` and `canvas`, so it shows layout and interaction, never a message, a guest's name, a calendar or an uploaded screenshot. Autocapture runs with `mask_all_text` and `mask_all_element_attributes`, so a click names the element by its tag and its place in the page only (no text, classes or attributes): a calendar block's `aria-label`, for one, names the event and the guest. Network bodies and headers are not recorded. Surveys are off.

On `/app`, a signed-in host is identified by their host account ID, the same ID the server's events use, with person properties from `hostAnalyticsTraits` (handle, sign-up date, linked channel, calendar connected) and their standing (setup ready, next action). No name or email is sent. Signing out calls `posthog.reset()` before the form submits, or, when PostHog has not loaded yet, removes its `ph_*` cookies and storage. The traits query falls back to no traits if it fails, so analytics never breaks `/app`. Guests on host pages and booking links are never identified; `person_profiles: "identified_only"` keeps them without profiles.

### D7. Server events without content

`captureServerEvent` sends one event in the background and never throws: it reads the gate on every call, the client sends each event at once (`flushAt: 1`) with a 3-second timeout, and `waitUntil` from `@vercel/functions` keeps the function alive until it is sent inside a Vercel request. Outside one, as in an eve hook that runs after its request, the send runs unawaited and can be lost if the instance freezes.

- `runCommand` sends the operation's name (`request.start`, `request.approve`, `booking.cancel`, ...) with the actor's kind once a command commits, not when a retry is replayed, and `command_failed` with the operation, category and reason on failure.
- `runWorkerBatch` sends `job_processed` with the job's kind, attempt and result.
- `storeReceipt` sends `channel_message_received` with the channel (`imessage`, `whatsapp`, `telegram`) and the content and space type; the AgentMail receiver sends it with channel `email`.
- `agent/hooks/analytics.ts` sends `agent_session_started`, `agent_turn_completed`, `agent_turn_failed` with its code, and `agent_tool_called` with the tool's name and status, each with the session's audience.

A host is identified by their host account ID, with a person profile. Anyone else is a pseudonym, the scope plus 20 hex characters of a SHA-256 of its ID (`request:…`, `guest:…`, `agent:…`), or the scope alone, with `$process_person_profile: false`. No resource ID, message text, phone number, email address, name or calendar is sent.

## Risks

- A future page that puts a credential in a single-segment path would be reported, and so would a credential that looks like a file name. Credentials have so far been one segment deeper, and the unit tests list the current routes.
- An attribute outside the masked list (such as `id` or `href` to another site) is still recorded in replay. Masked attributes hide what the app writes about people today; a new attribute that carries such words needs adding to the list.
- The notice states the US region; choosing `POSTHOG_REGION=eu` needs the notice changed in the same deploy.
- Uncompressed replay snapshots use more bandwidth.
- An event sent from inside a transaction can be sent for a transaction that then fails to commit; `storeReceipt` sends after its last write, so this needs a failed commit.
