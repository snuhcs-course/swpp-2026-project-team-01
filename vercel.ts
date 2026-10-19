import { withEve } from "eve/vercel";

export default await withEve({
  // Beside the shared Supabase project in us-east-2 (design decision 11).
  regions: ["cle1"],
  services: {
    web: { framework: "nextjs", root: "apps/web" },
  },
  routes: [{ src: "^(.*)$", destination: { type: "service", service: "web" } }],
});
