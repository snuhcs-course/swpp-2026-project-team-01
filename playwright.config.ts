import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./tests/e2e/support/token-key";

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
const baseURL = `http://localhost:${PORT}`;
const live = process.env.E2E_LIVE_MODEL === "1";

function liveOpenAIKey() {
  const files = [".env.local", ".env"].filter((file) => existsSync(file));
  const key =
    process.env.OPENAI_API_KEY || files.map((file) => parseEnv(readFileSync(file, "utf8")).OPENAI_API_KEY).find(Boolean);

  if (!key) throw new Error("E2E_LIVE_MODEL=1 needs OPENAI_API_KEY.");
  return key;
}

const model: Record<string, string> = live
  ? { OPENAI_API_KEY: liveOpenAIKey() }
  : { OPENAI_API_KEY: "sk-test-not-a-real-key", OPENAI_BASE_URL: `http://127.0.0.1:${FAKE_OPENAI_PORT}/v1` };

const stack = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" })) as {
  API_URL: string;
  DB_URL: string;
  PUBLISHABLE_KEY: string;
};
const shared = {
  DATABASE_URL: stack.DB_URL,
  EVE_INTERNAL_SIGNING_KEY: "e2e-internal-signing-key-for-the-local-stack-only",
  SUPABASE_PROJECT_REF: "local",
  SUPABASE_PUBLISHABLE_KEY: stack.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: "",
  SUPABASE_URL: stack.API_URL,
  // Google's token endpoint and Calendar API, served by the local stand-in.
  GOOGLE_CALENDAR_API_URL: `http://127.0.0.1:${FAKE_GOOGLE_PORT}/calendar/v3`,
  GOOGLE_CLIENT_ID: "e2e-google-client",
  GOOGLE_CLIENT_SECRET: "e2e-google-secret",
  GOOGLE_OAUTH_TOKEN_URL: `http://127.0.0.1:${FAKE_GOOGLE_PORT}/token`,
  // The requester consent round trip, against the same stand-in.
  GOOGLE_REQUESTER_AUTH_URL: `http://127.0.0.1:${FAKE_GOOGLE_PORT}/o/oauth2/v2/auth`,
  GOOGLE_REQUESTER_CLIENT_ID: "e2e-google-requester-client",
  GOOGLE_REQUESTER_CLIENT_SECRET: "e2e-google-requester-secret",
  GOOGLE_TOKEN_INFO_URL: `http://127.0.0.1:${FAKE_GOOGLE_PORT}/tokeninfo`,
  // Google Routes and Cloudflare Email Sending, served by local stand-ins; the
  // messaging gate admits local sending only toward these loopback endpoints.
  CLOUDFLARE_ACCOUNT_ID: "e2e-account",
  CLOUDFLARE_EMAIL_API_TOKEN: "e2e-email-token",
  CLOUDFLARE_EMAIL_API_URL: `http://127.0.0.1:${FAKE_CLOUDFLARE_PORT}`,
  CLOUDFLARE_EMAIL_FROM: "no-reply@e2e.example.test",
  GOOGLE_MAPS_API_KEY: "fake-routes-key",
  GOOGLE_ROUTES_API_URL: `http://127.0.0.1:${FAKE_ROUTES_PORT}`,
  // The product inbox Continue by email names; nothing reaches AgentMail.
  AGENTMAIL_INBOX_ID: "findmeatime@agentmail.test",
  // One key per run, shared with the tests so they can seal a Calendar grant.
  TOKEN_ENCRYPTION_KEY: E2E_TOKEN_ENCRYPTION_KEY,
};

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  testMatch: live ? "**/first-reply.test.ts" : "**/*.test.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
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
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: baseURL,
    },
  ],
});
