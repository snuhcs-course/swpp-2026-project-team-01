# CalTalk setup

## Run the app

1. Install Node.js and the Expo prerequisites.
2. From `apps/mobile`, run `npm install`.
3. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
4. Run `npm run web` for the web experience, or `npm run ios` / `npm run android` for a device or simulator.

## Deploy the web app to Vercel

The Expo app exports a static web build to `apps/mobile/dist`. In Vercel, import the Git repository and set the project Root Directory to `apps/mobile`; Vercel will use the included `vercel.json` to install dependencies, run the export, and publish `dist`. Add the two `EXPO_PUBLIC_SUPABASE_*` variables in the Vercel project settings only after configuring Supabase. These values are public client configuration; never add a service role key.

For a CLI deployment from this folder, link the Vercel project once with `vercel link`, then run `vercel deploy` for a preview or `vercel deploy --prod` to publish production. Confirm the linked Vercel project and deployment target before using `--prod`.

Without Supabase values, the app opens sample proposals in preview mode. Demo approvals only remove the sample card; they do not book a real event.

## Supabase

Create a Supabase project, install the Supabase CLI, link the project, then run `supabase db push` from the repository root. For local development, use `supabase start` and `supabase db reset`. Configure host authentication before using the private inbox. Never put a service role key in an Expo public environment variable.

The first migration creates the initial data model and host-only RLS policies. Requester and agent access should be implemented through authenticated Edge Functions or another trusted server endpoint with narrowly scoped tokens; do not relax RLS to expose the host's calendar or preferences.

## Integration sequence

1. Add host sign-in and calendar OAuth with server-held credentials.
2. Implement request creation and follow-up chat in an Edge Function, validating idempotency keys.
3. Read free/busy and owner preference data server-side; return only safe candidate slots to requesters.
4. Implement host notifications and proposal-version checks.
5. On explicit host approval, recheck free/busy, create the calendar event idempotently, then confirm to both sides.
6. Publish a machine-readable booking API and verify each external agent client before advertising compatibility.
