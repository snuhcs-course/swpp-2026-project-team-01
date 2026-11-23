import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";
import { type LocalStack, modelEnv, serviceEnv, type StandInPorts } from "./tests/e2e/support/service-env";

// Browser tests run the web service (next dev), the agent service (eve dev) and a
// local stand-in for OpenAI, all against the local Supabase stack started with
// `supabase start`. Every variable is set here, so the root .env (which may name
// a hosted project) is never used.
//
// E2E_LIVE_MODEL=1 is the opt-in live run: it runs only the first-reply journey,
// and the agent service calls the real gpt-5.6-terra with OPENAI_API_KEY from the
// environment, .env.local or .env (nothing else is read from those files). It
// spends real money, so CI never sets it.

const PORT = process.env.PORT ?? "3100";
const EVE_PORT = "3101";
const FAKE_OPENAI_PORT = "3102";
const FAKE_GOOGLE_PORT = "3103";
const FAKE_CLOUDFLARE_PORT = "3104";
const FAKE_ROUTES_PORT = "3105";
const FAKE_PHOTON_PORT = "3106";
const baseURL = `http://localhost:${PORT}`;
const live = process.env.E2E_LIVE_MODEL === "1";

function liveOpenAIKey() {
  const files = [".env.local", ".env"].filter((file) => existsSync(file));
  const key =
    process.env.OPENAI_API_KEY || files.map((file) => parseEnv(readFileSync(file, "utf8")).OPENAI_API_KEY).find(Boolean);

  if (!key) throw new Error("E2E_LIVE_MODEL=1 needs OPENAI_API_KEY.");
  return key;
}

const ports: StandInPorts = {
  cloudflare: FAKE_CLOUDFLARE_PORT,
  google: FAKE_GOOGLE_PORT,
  openai: FAKE_OPENAI_PORT,
  photon: FAKE_PHOTON_PORT,
  routes: FAKE_ROUTES_PORT,
};
const model = modelEnv(ports, live ? liveOpenAIKey() : undefined);

const stack = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" })) as LocalStack;
const shared = serviceEnv(stack, ports);

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  testMatch: live ? "**/first-reply.test.ts" : "**/*.test.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // The CI runner also hosts Supabase, Next and Eve. Keep one browser worker
  // so those services have room during the full end-to-end run.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "list" : "html",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npx tsx tests/e2e/support/fake-google-server.ts",
      env: { FAKE_GOOGLE_PORT },
      reuseExistingServer: false,
      url: `http://127.0.0.1:${FAKE_GOOGLE_PORT}/health`,
    },
    {
      command: "npx tsx tests/e2e/support/fake-cloudflare-server.ts",
      env: { FAKE_CLOUDFLARE_PORT },
      reuseExistingServer: false,
      url: `http://127.0.0.1:${FAKE_CLOUDFLARE_PORT}/health`,
    },
    {
      command: "npx tsx tests/e2e/support/fake-photon-server.ts",
      env: { FAKE_PHOTON_PORT },
      reuseExistingServer: false,
      url: `http://127.0.0.1:${FAKE_PHOTON_PORT}/health`,
    },
    {
      command: "npx tsx tests/e2e/support/fake-routes-server.ts",
      env: { FAKE_ROUTES_PORT },
      reuseExistingServer: false,
      url: `http://127.0.0.1:${FAKE_ROUTES_PORT}/health`,
    },
    ...(live
      ? []
      : [
          {
            command: "npx tsx tests/e2e/support/fake-openai-server.ts",
            env: { FAKE_OPENAI_PORT },
            reuseExistingServer: false,
            url: `http://127.0.0.1:${FAKE_OPENAI_PORT}/health`,
          },
        ]),
    {
      command: `npx eve dev --no-ui --host 127.0.0.1 --port ${EVE_PORT}`,
      env: {
        ...shared,
        EVE_AGENT_URL: `http://127.0.0.1:${EVE_PORT}`,
        EVE_TELEMETRY_DISABLED: "1",
        NODE_ENV: "production",
        ...model,
      },
      reuseExistingServer: false,
      timeout: 180_000,
      url: `http://127.0.0.1:${EVE_PORT}/eve/v1/health`,
    },
    {
      command: `next dev apps/web --port ${PORT}`,
      env: {
        ...shared,
        APP_ORIGIN: baseURL,
        EVE_AGENT_URL: `http://127.0.0.1:${EVE_PORT}`,
        NEXT_PUBLIC_E2E_TEST: "1",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: baseURL,
    },
  ],
});
