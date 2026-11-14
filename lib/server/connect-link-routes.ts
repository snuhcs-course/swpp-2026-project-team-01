import { z } from "zod";
import type { ImessageStatus } from "../contracts/imessage";
import type { RequesterImessageStatus } from "../contracts/requester-imessage";
import { readDefaultRoleCalendars } from "./calendar-roles";
import { json } from "./chat-routes";
import { CommandError, runCommand, type CommandDefinition } from "./commands";
import { readConnectAttempt, CLOSED_LINK } from "./connect-link";
import { googleCalendarConfigFromEnvironment } from "./google-calendar";
import { readHostStanding } from "./host-eligibility";
import { cancelImessageLinkCommand, confirmImessageLinkCommand, linkChannels, linkLockKey, lockHostLinking, readImessageStatus } from "./imessage-links";
import { imessageRouteDependenciesFromEnvironment, type ImessageRouteDependencies } from "./imessage-routes";
import { confirmRequesterImessageLinkCommand, readRequesterImessageStatus, unlinkRequesterImessageCommand } from "./requester-imessage-links";
import { crossSiteRefusal, requestAppOrigin, unknownHost } from "./same-origin";
import { verifiedUserId } from "./supabase-auth";

export type ConnectLinkView = { state: "closed" } | { state: "sign_in" } | { state: "open"; status: Extract<ImessageStatus | RequesterImessageStatus, { state: "pending" | "received" }> };

async function authorized(deps: ImessageRouteDependencies, request: Request, token: string) {
  const attempt = await readConnectAttempt(deps.db, deps.tokenKeys, token);
  if (!attempt) return { state: "closed" as const };
  if (attempt.role === "host") {
    const user = await verifiedUserId(request, deps.auth);
    if (!user) return { state: "sign_in" as const };
    const host = await readHostStanding(deps.db, user);
    if (!host.eligible || host.hostAccountId !== attempt.host_account_id) return { state: "closed" as const };
  }
  return { state: "open" as const, attempt };
}

export async function readConnectLink(deps: ImessageRouteDependencies, request: Request, token: string): Promise<ConnectLinkView> {
  const access = await authorized(deps, request, token);
  if (access.state !== "open") return access;
  // Serialize against replacement so this token never shows another attempt's code.
  return await deps.db.begin(async tx => {
    const attempt = access.attempt;
    await tx`select pg_advisory_xact_lock(hashtextextended(${linkLockKey({ ...attempt, starter_hash: null })}, 0))`;
    if (!(await readConnectAttempt(tx, deps.tokenKeys, token))) return { state: "closed" as const };
    const status = attempt.role === "host"
      ? await readImessageStatus(tx, deps.tokenKeys, attempt.host_account_id!, linkChannels(deps))
      : await readRequesterImessageStatus(tx, deps.tokenKeys, attempt.request_id!, deps.lineNumber, deps.whatsappNumber);
    if (status.state !== "pending" && status.state !== "received") return { state: "closed" as const };
    return { state: "open" as const, status };
  });
}

const bodySchema = z.object({ action: z.enum(["confirm", "cancel"]), retryKey: z.string().min(8).max(200) }).strict();
export function createConnectLinkHandler(load: () => ImessageRouteDependencies = imessageRouteDependenciesFromEnvironment) {
  return async (request: Request, token: string) => {
    const deps = load();
    const origin = requestAppOrigin(request, deps);
    if (!origin) return unknownHost();
    if (request.method === "GET") return json(await readConnectLink(deps, request, token));
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
    const refused = crossSiteRefusal(request, deps, { json: true });
    if (refused) return refused;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: "Invalid input." }, 400);
    const access = await authorized(deps, request, token);
    if (access.state !== "open") return json({ error: CLOSED_LINK }, 410);
    const { attempt } = access;
    const { action, retryKey } = parsed.data;
    const resourceId = (attempt.role === "host" ? attempt.host_account_id : attempt.request_id)!;
    const liveCalendars = attempt.role === "host" && action === "confirm"
      ? await readDefaultRoleCalendars(deps.db, resourceId, { config: googleCalendarConfigFromEnvironment(), tokenKeys: deps.tokenKeys }) : null;
    const options = { ...deps, origin, liveCalendars };
    async function execute<Input, Result>(command: CommandDefinition<Input, Result>, input: Input) {
      const guarded: CommandDefinition<Input, Result> = {
        ...command,
        async run(tx, context) {
          if (attempt.role === "host") await lockHostLinking(tx, resourceId);
          else {
            await tx`select id from app.requests where id = ${resourceId} for update`;
            await tx`select pg_advisory_xact_lock(hashtextextended(${linkLockKey({ ...attempt, starter_hash: null })}, 0))`;
          }
          if (!(await readConnectAttempt(tx, deps.tokenKeys, token))) throw new CommandError("stale_revision");
          return command.run(tx, context);
        },
      };
      return runCommand({ db: deps.db, authenticate: async () => ({ kind: attempt.role === "host" ? "host_account" : "requester_request", id: resourceId }) }, guarded, {
        input, resourceId, retryKey: `connect-link:${attempt.id}:${retryKey}`,
      });
    }
    const outcome = attempt.role === "host"
      ? action === "confirm" ? await execute(confirmImessageLinkCommand(options), { linkId: attempt.id }) : await execute(cancelImessageLinkCommand, {})
      : action === "confirm" ? await execute(confirmRequesterImessageLinkCommand(options), { linkId: attempt.id }) : await execute(unlinkRequesterImessageCommand, { pendingOnly: true });
    return outcome.ok ? json({ state: action === "confirm" ? "linked" : "closed", message: action === "confirm" ? "Linked. You can go back to your agent." : CLOSED_LINK }) : json({ error: outcome.error.message }, 409);
  };
}
