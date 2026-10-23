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
        },
      },
    ],
  },
});
