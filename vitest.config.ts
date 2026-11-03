import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web app's own import aliases, for its component tests. Targets use
  // forward slashes so the aliases also resolve on Windows.
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("./apps/web/", import.meta.url)).replaceAll("\\", "/"),
      "@lib/": fileURLToPath(new URL("./lib/", import.meta.url)).replaceAll("\\", "/"),
    },
  },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["{agent,apps,cli,lib}/**/*.test.{ts,tsx}"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          // Some suites drive a real eve server and the local Supabase stack. eve dev
          // servers started from one project share its local workflow queue, so
          // files run one at a time.
          fileParallelism: false,
          testTimeout: 60_000,
          include: ["tests/integration/**/*.test.ts"],
          // Commands that read Google with the environment's configuration
          // (agreement's calendar recheck) load it against the local stack and
          // reach a closed port, never Google, so they go ahead as when Google
          // is unavailable; suites that need Calendar answers pass the fake
          // Google explicitly. Nothing in the suites is sealed with this key.
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
            GOOGLE_CALENDAR_API_URL: "http://127.0.0.1:9/calendar/v3",
            GOOGLE_OAUTH_TOKEN_URL: "http://127.0.0.1:9/token",
            TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
          },
        },
      },
    ],
  },
});
