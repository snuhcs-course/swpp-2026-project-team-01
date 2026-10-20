import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { setupDependenciesFromEnvironment } from "../../lib/server/setup";
import {
  draftSettingsForTool,
  draftSettingsToolInput,
  isHostSetupSession,
  readSetupStateForTool,
} from "../../lib/server/setup-tools";

// The host setup tools (agent configuration: tools and permission layer 2). They
// resolve only for a host setup session, so every other audience has nothing to
// call; each execute rechecks the fence before it reads or writes. Callbacks are
// inline and use only module-level imports, so eve can replay them.
export default defineDynamic({
  events: {
    "session.started": (_event, ctx) =>
      isHostSetupSession(ctx.session.auth.current)
        ? {
            read_setup_state: defineTool({
              description:
                "Read the host's current setup: the next action, drafted values with their labels, current suggestions with sample sizes, missing required fields, calendar roles, analysis evidence and readiness. Call it at the start of each turn before talking about setup.",
              inputSchema: z.object({}),
              execute: (_input, toolCtx) =>
                readSetupStateForTool(setupDependenciesFromEnvironment(), {
                  auth: toolCtx.session.auth.current,
                  callId: toolCtx.callId,
                  sessionId: toolCtx.session.id,
                }),
            }),
            draft_settings: defineTool({
              description:
                "Record setup values in the host's draft, each labeled stated (the host said it in this conversation) or inferred (derived from evidence). It never saves settings and never accepts a value for the host; meeting mode, location and travel mode take only source stated.",
              inputSchema: draftSettingsToolInput,
              execute: (input, toolCtx) =>
                draftSettingsForTool(
                  setupDependenciesFromEnvironment(),
                  { auth: toolCtx.session.auth.current, callId: toolCtx.callId, sessionId: toolCtx.session.id },
                  input,
                ),
            }),
          }
        : null,
  },
});
