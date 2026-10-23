import { startFakePhoton } from "../../integration/support/fake-photon";

// The browser tests' Photon: the stand-in send endpoint on a fixed port, so the
// app started by Playwright (with PHOTON_API_URL pointed here) never texts
// anyone. GET /__sends lists what was sent. Run with `npx tsx`.
const port = Number(process.env.FAKE_PHOTON_PORT ?? "3106");
const fake = await startFakePhoton({ port });
console.log(`Fake Photon listening at ${fake.baseUrl}`);
