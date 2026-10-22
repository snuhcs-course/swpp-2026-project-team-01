import { z } from "zod";
import type { AgentRole, AgentScope } from "../contracts/agent-access";
import { COMMAND_ERROR_MESSAGES, type CommandErrorCategory, type CommandFailure } from "../contracts/command-errors";
import type { GrantAccess } from "./agent-grants";
import { type Actor, type CommandDefinition, runCommand } from "./commands";
import type { Database } from "./database";
import type { SetupDependencies } from "./setup";
import type { TokenKey } from "./token-encryption";

// The MCP tools' shared shape (agent-access design 4). A tool is either a read
// that returns a projection, or a command tool that runs one existing command
// through the pipeline as the grant's actor, with the agent's retry key bound
// to the grant (mcp:{grantId}:{retryKey}) so its retries replay only its own
// outcomes. Command failures become tool errors with the stable category, its
// fixed message and a next action the agent can follow; they are never
// protocol errors.

export type AgentToolDependencies = {
  readonly db: Database;
  readonly origin: string;
  readonly setup: SetupDependencies;
  readonly tokenKey: () => TokenKey;
  // How long find_times and evaluate_request wait for the evaluation.
  readonly evaluationWaitMs?: number;
};

export type AgentToolContext = {
  readonly deps: AgentToolDependencies;
  readonly access: GrantAccess;
};

export type ToolResult =
  | { readonly ok: true; readonly result: unknown }
  | {
      readonly ok: false;
      readonly category: CommandErrorCategory | "request_unavailable" | "already_created" | "proposal_superseded";
      readonly message: string;
      readonly nextAction: string;
      readonly correlationId?: string;
    };

export type AgentTool = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly role: AgentRole;
  readonly scope: AgentScope;
  readonly input: z.ZodType;
  readonly readOnly: boolean;
  // Whether the tool closes or gives up something for good (withdrawal).
  readonly destructive?: boolean;
  // Whether the tool may run on an unbound bootstrap grant or a closed request.
  readonly bootstrap?: boolean;
  readonly afterClosure?: boolean;
  readonly run: (context: AgentToolContext, input: unknown) => Promise<ToolResult>;
};

export const retryKeySchema = z
  .string()
  .min(8)
  .max(200)
  .describe("A unique key for this action. Repeat the same key with the same arguments to retry it safely after a lost response; use a new key for a new action.");

export const expectedRevisionSchema = z
  .number()
  .int()
  .min(0)
  .describe("The request or setup revision from the last read. A stale revision is refused, so read again and retry.");

export function unavailable(): ToolResult {
  return {
    category: "request_unavailable",
    message: "That request is not available.",
    nextAction: "Use a request ID from list_requests or get_request; another person's request looks the same as an unknown one.",
    ok: false,
  };
}

const NEXT_ACTIONS: Readonly<Record<CommandErrorCategory, string>> = {
  booking_pending: "Booking has started. Read the request again for its outcome; nothing can be changed meanwhile.",
  forbidden: "This is not available to this connection.",
  identity_required: "The requester's name and email are needed first.",
  internal: "Try again later with the same retryKey.",
  invalid_input: "Check the arguments against the tool's input schema and the request's current state, then try again with a new retryKey.",
  rate_limited: "Wait and try again later.",
  request_closed: "The request is closed. Read it with get_request for its status.",
  retry_conflict: "This retryKey was used for a different action; use a new retryKey.",
  stale_revision: "Read the request again and retry with its current revision as expectedRevision and a new retryKey.",
  unauthenticated: "Reconnect the agent.",
  unavailable_configuration: "The service is not fully configured for this; tell the person to continue on the web.",
};

export function commandError(error: CommandFailure): ToolResult {
  if (error.category === "forbidden") return unavailable();
  if (error.reason === "proposal_superseded") {
    return {
      category: "proposal_superseded",
      correlationId: error.correlationId,
      message: "A newer proposal version replaced the one named.",
      nextAction: "Read the request again with get_request and use the current proposal version.",
      ok: false,
    };
  }
  const nextAction =
    error.reason === "start_passed"
      ? "That time has already started. Find times again."
      : error.reason === "destination_not_writable"
        ? "The booking calendar can no longer take events. Choose a writable one in Find Me a Time."
        : NEXT_ACTIONS[error.category];
  return { category: error.category, correlationId: error.correlationId, message: COMMAND_ERROR_MESSAGES[error.category], nextAction, ok: false };
}

export function actorOf(access: GrantAccess): Actor | null {
  if (access.role === "host") return { id: access.hostAccountId, kind: "host_account" };
  return access.requestId ? { id: access.requestId, kind: "requester_request" } : null;
}

export async function runAsGrant<Input, Result>(
  context: AgentToolContext,
  command: CommandDefinition<Input, Result>,
  request: { readonly resourceId: string; readonly retryKey: string; readonly expectedRevision?: number | null; readonly input: unknown },
) {
  const actor = actorOf(context.access);
  return runCommand({ authenticate: async () => actor, db: context.deps.db }, command, {
    expectedRevision: request.expectedRevision ?? null,
    input: request.input,
    resourceId: request.resourceId,
    retryKey: `mcp:${context.access.grantId}:${request.retryKey}`,
  });
}

// The JSON Schema of a tool's input, for tools/list.
export function inputSchema(tool: AgentTool) {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return schema;
}

export function toolDefinition(tool: AgentTool) {
  return {
    annotations: {
      destructiveHint: tool.destructive ?? false,
      // Mutations repeat safely with the same retryKey.
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: tool.readOnly,
      title: tool.title,
    },
    description: tool.description,
    inputSchema: inputSchema(tool),
    name: tool.name,
    title: tool.title,
  };
}
