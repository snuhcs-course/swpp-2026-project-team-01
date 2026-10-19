import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";

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
};

export default defineConfig({
  testDir: "./tests/e2e",
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
        TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: baseURL,
    },
  ],
});
