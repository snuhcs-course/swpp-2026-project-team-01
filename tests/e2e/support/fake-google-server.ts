import { defaultGoogleFixture, startFakeGoogle } from "../../integration/support/fake-google";

// The browser tests' Google: the OAuth token endpoint and Calendar API stand-in on
// a fixed port, so the app started by Playwright (with GOOGLE_OAUTH_TOKEN_URL and
// GOOGLE_CALENDAR_API_URL pointed here) never calls Google. Every refresh token
// reads the default fixture unless a test posts its own to /__fixture/:refreshToken;
// the refresh token "revoked" always answers invalid_grant. Run with `npx tsx`.
const port = Number(process.env.FAKE_GOOGLE_PORT ?? "3103");
const fake = await startFakeGoogle({ defaultFixture: defaultGoogleFixture(), port });
console.log(`Fake Google listening at ${fake.origin} (token ${fake.tokenUrl}, Calendar ${fake.apiBaseUrl})`);
