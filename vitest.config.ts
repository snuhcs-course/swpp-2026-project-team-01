import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["{agent,apps,lib}/**/*.test.{ts,tsx}"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          // Some suites drive a real eve server and the local Supabase stack.
          testTimeout: 60_000,
          include: ["tests/integration/**/*.test.ts"],
        },
      },
    ],
  },
});
