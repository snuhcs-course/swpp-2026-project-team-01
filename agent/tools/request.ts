import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { database } from "../../lib/server/database";
import {
  askForIdentityForTool,
  draftRequestReviewForTool,
  draftRequestReviewToolInput,
  evaluateCandidatesForTool,
  isRequesterSession,
  readBookingStatusForTool,
  readRequestForTool,
} from "../../lib/server/request-tools";
import type { SessionPrincipal } from "../../lib/server/setup-tools";

// The request-discussion tools (agent configuration: tools and permission layer
// 2; design decision 12). One resolver serves every request discussion and
// returns the tool set of the session's audience: in this phase only the
// requester audience has one, so host setup sessions get nothing from here, and
// a requester session gets no host tool. A draft request (the guest's thread
// before they give a name and email) has the same tools; the draft state is
// checked inside each operation. ask_for_identity is the structured signal that
// the assistant asked for a name and email, which places the identity card. Phase 4 adds the
// host review set beside requesterTools(), with the shared tools returning the
// host projection. Each execute rechecks the fence before it reads or writes.
// Callbacks are inline and use only module-level imports, so eve can replay them.

type ToolContext = {
  readonly callId: string;
  readonly session: { readonly id: string; readonly auth: { readonly current: SessionPrincipal } };
};

function call(toolCtx: ToolContext) {
  return { auth: toolCtx.session.auth.current, callId: toolCtx.callId, sessionId: toolCtx.session.id };
}

function requesterTools() {
  return {
    read_request: defineTool({
      description:
        "Read this meeting request as the requester may see it: status, meeting details (purpose, duration, mode, place or meeting link plan, availability windows in the requester's timezone), what is still missing, the pending review, the current candidate times and proposal. Contact details appear only as present or absent. It contains nothing about the host's calendar or rules. Call it at the start of each turn.",
      inputSchema: z.object({}),
      execute: (_input, toolCtx) => readRequestForTool(database(), call(toolCtx)),
    }),
    draft_request_review: defineTool({
      description:
        "Declare what the requester's message means for the request: details or availability with only the fields they stated, or question or unknown with the clarification categories to ask about. It creates a review the requester applies or dismisses on the review card; it never changes the request, agrees, approves or books. If it returns a question, ask exactly that question.",
      inputSchema: draftRequestReviewToolInput,
      execute: (input, toolCtx) => draftRequestReviewForTool(database(), call(toolCtx), input),
    }),
    evaluate_candidates: defineTool({
      description:
        "Find feasible meeting times for the current details. It waits up to 20 seconds and returns candidate times for the requester, or the evaluation's identity while it is still running; the candidate times card shows the same result. It cannot choose a time: the requester presses Choose this time on the card. Before the guest has given a name and email it returns identityRequired and finds nothing; the identity card then appears in the conversation.",
      inputSchema: z.object({}),
      execute: (_input, toolCtx) => evaluateCandidatesForTool(database(), call(toolCtx)),
    }),
    ask_for_identity: defineTool({
      description:
        "Call this in the same turn as you ask the guest for their name and email, while read_request says identified: false. It shows the identity card (Continue with Google, Continue without Google) in the conversation right after your message; it records nothing about the guest. Never ask them to type their name or email as a message.",
      inputSchema: z.object({}),
      execute: (_input, toolCtx) => askForIdentityForTool(database(), call(toolCtx)),
    }),
    read_booking_status: defineTool({
      description:
        "Read the request's status from the records: gathering, negotiating, awaiting the host's approval, or closed, and which proposal version the requester agreed to. Nothing is booked until the host approves.",
      inputSchema: z.object({}),
      execute: (_input, toolCtx) => readBookingStatusForTool(database(), call(toolCtx)),
    }),
  };
}

export default defineDynamic({
  events: {
    "session.started": (_event, ctx) => (isRequesterSession(ctx.session.auth.current) ? requesterTools() : null),
  },
});
