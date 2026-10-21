import { startFakeCloudflare } from "../../integration/support/fake-cloudflare";

// The browser tests' Cloudflare Email Service: the REST send endpoint on a fixed
// port, so the app started by Playwright (with CLOUDFLARE_EMAIL_API_URL pointed
// here) never sends real mail. Every recipient is delivered unless a test posts a
// behavior to /__behavior/:recipient. Run with `npx tsx`.
const port = Number(process.env.FAKE_CLOUDFLARE_PORT ?? "3104");
const fake = await startFakeCloudflare({ port });
console.log(`Fake Cloudflare listening at ${fake.baseUrl}`);
