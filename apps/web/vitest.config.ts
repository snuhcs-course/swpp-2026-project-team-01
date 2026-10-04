import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

const resolve = { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }
export default defineConfig({
  resolve,
  test: { projects: [
    { resolve, test: { name: "unit", environment: "node", include: ["tests/**/*.test.ts"], exclude: ["tests/components/**"] } },
    { resolve, test: { name: "components", environment: "jsdom", include: ["tests/components/**/*.test.{ts,tsx}"], setupFiles: ["./tests/components/setup.ts"] } },
  ] },
})
