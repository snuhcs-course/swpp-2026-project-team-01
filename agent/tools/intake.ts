import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { database } from "../../lib/server/database";
import {
  draftIntakeForTool,
  draftIntakeToolInput,
  isPublicIntakeSession,
  readIntakeForTool,
} from "../../lib/server/intake-tools";

// The public intake tools (agent configuration: tools and permission layer 2).
// They resolve only for a public_intake session, so a host or requester session
// never has them and an intake session has nothing else: no host settings,
// calendar, request or other intake is reachable from it. Each execute rechecks
// the fence before it reads or writes. Callbacks are inline and use only
// module-level imports, so eve can replay them.
export default defineDynamic({
  events: {
    "session.started": (_event, ctx) =>
      isPublicIntakeSession(ctx.session.auth.current)
        ? {
            read_intake: defineTool({
              description:
                "Read the host's public profile (display name and handle) and what this visitor has described so far: purpose, duration, meeting mode, place and availability windows, with the visitor's timezone and language. It contains nothing about the host's calendar, rules or availability. Call it at the start of each turn.",
              inputSchema: z.object({}),
              execute: (_input, toolCtx) =>
                readIntakeForTool(database(), { auth: toolCtx.session.auth.current, sessionId: toolCtx.session.id }),
            }),
            draft_intake: defineTool({
              description:
                "Record what the visitor stated about the meeting in the intake draft: purpose, durationMinutes, mode (online, in_person or either), location, and windows as local dates (YYYY-MM-DD) with start and end clock times (HH:MM, 24-hour) in the visitor's timezone. Record only what the visitor said. The draft becomes a review the visitor applies after the request exists; it books nothing.",
              inputSchema: draftIntakeToolInput,
              execute: (input, toolCtx) =>
                draftIntakeForTool(database(), { auth: toolCtx.session.auth.current, sessionId: toolCtx.session.id }, input),
            }),
          }
        : null,
  },
});
