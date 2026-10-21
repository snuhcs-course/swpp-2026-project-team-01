import { startFakeRoutes } from "../../integration/support/fake-routes";

// The browser tests' Google Routes: computeRoutes on a fixed port, so the job
// worker Playwright starts (with GOOGLE_ROUTES_API_URL pointed here) never calls
// Google. Unknown trips have no route. Run with `npx tsx`.
const port = Number(process.env.FAKE_ROUTES_PORT ?? "3105");
const fake = await startFakeRoutes({ port });
console.log(`Fake Routes listening at ${fake.baseUrl}`);
