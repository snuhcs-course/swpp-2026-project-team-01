import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // The mockup instance (npm run dev:mock) builds into its own folder so it can run next to the real one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
}

export default nextConfig
