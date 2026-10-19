import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Browser tests run the web service (next dev), the agent service (eve dev) and a
// local stand-in for OpenAI, all against the local Supabase stack started with
// `supabase start`. Every variable is set here, so the root .env (which may name
// a hosted project) is never used.

const PORT = process.env.PORT ?? "3100";
const EVE_PORT = "3101";
const FAKE_OPENAI_PORT = "3102";
const baseURL = `http://localhost:${PORT}`;

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
};

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.test.ts",
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
      command: "npx tsx tests/e2e/support/fake-openai-server.ts",
      env: { FAKE_OPENAI_PORT },
      reuseExistingServer: false,
      url: `http://127.0.0.1:${FAKE_OPENAI_PORT}/health`,
    },
    {
      command: `npx eve dev --no-ui --host 127.0.0.1 --port ${EVE_PORT}`,
      env: {
        ...shared,
        EVE_TELEMETRY_DISABLED: "1",
        NODE_ENV: "production",
        OPENAI_API_KEY: "sk-test-not-a-real-key",
        OPENAI_BASE_URL: `http://127.0.0.1:${FAKE_OPENAI_PORT}/v1`,
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
        TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: baseURL,
    },
  ],
});
