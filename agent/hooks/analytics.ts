import { defineHook } from "eve/hooks";
import { type AnalyticsSubject, captureServerEvent } from "../../lib/server/product-analytics";

// Reports the agent's sessions, turns and tool calls to product analytics
// (web-analytics design D7): the audience, a tool's name and whether it failed,
// a failed turn's code. Never a message, a tool's input or its output. A host's
// discussion is attributed to their host account; a guest's to a hash of its
// session principal. Hooks cannot veto work, and capturing never throws.
type Principal = { readonly principalId?: string; readonly attributes?: Readonly<Record<string, unknown>> } | null | undefined;

const HOST_AUDIENCES = new Set(["host_setup", "host_review"]);

function audienceOf(principal: Principal) {
  const audience = principal?.attributes?.audience;
  return typeof audience === "string" ? audience : null;
}

function subjectOf(principal: Principal): AnalyticsSubject {
  const audience = audienceOf(principal);
  if (audience && HOST_AUDIENCES.has(audience) && principal?.principalId) return { hostAccountId: principal.principalId, kind: "host" };
  return { id: principal?.principalId, kind: "anonymous", scope: "agent" };
}

function capture(event: string, principal: Principal, properties: Record<string, string | number | boolean | null> = {}) {
  captureServerEvent({ event, properties: { audience: audienceOf(principal), ...properties }, subject: subjectOf(principal) });
}

export default defineHook({
  events: {
    "session.started"(_event, ctx) {
      capture("agent_session_started", ctx.session.auth.current);
    },
    "turn.completed"(_event, ctx) {
      capture("agent_turn_completed", ctx.session.auth.current);
    },
    "turn.failed"(event, ctx) {
      capture("agent_turn_failed", ctx.session.auth.current, { code: event.data.code, terminal: event.data.terminal ?? null });
    },
    "action.result"(event, ctx) {
      const result = event.data.result as { readonly isError?: boolean; readonly kind?: string; readonly toolName?: string };
      if (typeof result.toolName !== "string") return;
      capture("agent_tool_called", ctx.session.auth.current, {
        is_error: result.isError === true || event.data.status !== "completed",
        status: event.data.status,
        tool: result.toolName,
      });
    },
  },
});
