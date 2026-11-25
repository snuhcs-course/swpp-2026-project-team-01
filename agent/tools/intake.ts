import { defineDynamic, defineTool } from "eve/tools";
import { database } from "../../lib/server/database";
import { intakeToolInput, setIntakeForTool } from "../../lib/server/host-intake-tools";
import { isHostSetupSession } from "../../lib/server/setup-tools";
import { isHostReviewSession } from "../../lib/server/host-review-tools";

export default defineDynamic({ events: {
  "session.started": (_event, ctx) => isHostSetupSession(ctx.session.auth.current) || isHostReviewSession(ctx.session.auth.current) ? {
    set_request_intake: defineTool({
      description: "Pause or resume NEW meeting requests when the host asks in their linked iMessage or Telegram. Read intake.revision with read_setup_state or read_settings first. Existing requests and messenger links continue. STOP/unlink is separate. Report saved only when saved=true; accepting=true still requires setup/calendar readiness.",
      inputSchema: intakeToolInput,
      execute: (input, toolCtx) => setIntakeForTool(database(), { auth: toolCtx.session.auth.current, sessionId: toolCtx.session.id, callId: toolCtx.callId }, input),
    }),
  } : {},
} });
