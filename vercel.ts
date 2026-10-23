import { withEve } from "eve/vercel";

export default await withEve({
  // Beside the shared Supabase project in us-east-2 (design decision 11).
  regions: ["cle1"],
  services: {
    web: { framework: "nextjs", root: "apps/web" },
  },
  routes: [
    // The AgentMail webhook receiver is a custom channel of the agent service
    // (requester-email-channel design 1); withEve publishes only /eve/v1 itself.
    { src: "^/agentmail/(.*)$", destination: { type: "service", service: "eve" } },
    // So is the Photon webhook receiver (host-imessage-channel design 2).
    { src: "^/photon/(.*)$", destination: { type: "service", service: "eve" } },
    { src: "^(.*)$", destination: { type: "service", service: "web" } },
  ],
});
