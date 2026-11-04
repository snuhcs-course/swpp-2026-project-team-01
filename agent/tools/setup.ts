import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { switchConversationForTool, switchConversationToolInput } from "../../lib/server/channel-selection";
import { database } from "../../lib/server/database";
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
            switch_conversation: defineTool({
              description:
                "Switch the host's linked iMessage or WhatsApp conversation to another request, or back to setup, when the host asks in words (\"let's talk about 박도현's request\", \"6ADSRV\", \"back to setup\"). Pass setup, the request reference, or the requester's name as the host wrote it. From the host's next message, their text goes to that discussion. It works only for a message from the linked conversation; on the web, the host opens the request from the inbox.",
              inputSchema: switchConversationToolInput,
              execute: (input, toolCtx) =>
                switchConversationForTool(database(), { auth: toolCtx.session.auth.current, sessionId: toolCtx.session.id }, input),
            }),
          }
        : null,
  },
});
