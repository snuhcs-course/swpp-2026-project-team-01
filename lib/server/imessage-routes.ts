import { runCommand, type CommandDefinition } from "./commands";
import { json } from "./chat-routes";
import { notifyWhenBackCommand, readPhoneLink, retryPhoneLinkCommand, startPhoneLinkCommand } from "./imessage-links";
import { crossSiteRefusal } from "./same-origin";
import { COMMAND_STATUS, eligibleHost, type SetupRouteDependencies, setupRouteDependenciesFromEnvironment } from "./setup-routes";

// Web routes for the phone check screens (host-imessage-linking). Like the setup
// routes, each authenticates the Supabase session itself, refuses a host that may
// not host and answers private, uncached JSON. Each POST runs as a command whose
// retry key is the Idempotency-Key header, so a resent tap is replayed rather
// than texting twice.

// GET /api/host/imessage/connection → { connection: PhoneLink | null }
export function createPhoneLinkReadHandler(load: () => SetupRouteDependencies = setupRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const actor = await eligibleHost(request, deps);

    if (actor instanceof Response) return actor;

    return json({ connection: await readPhoneLink(deps.db, actor.id) });
  };
}

function createPhoneLinkCommandHandler<Input, Result>(
  command: CommandDefinition<Input, Result>,
  load: () => SetupRouteDependencies,
) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });

    if (refused) return refused;

    const actor = await eligibleHost(request, deps);

    if (actor instanceof Response) return actor;

    const retryKey = request.headers.get("idempotency-key") ?? "";
    const input = await request.json().catch(() => null);
    const outcome = await runCommand({ authenticate: async () => actor, db: deps.db }, command, {
      input,
      resourceId: actor.id,
      retryKey,
    });

    return outcome.ok ? json(outcome.result) : json(outcome.error, COMMAND_STATUS[outcome.error.category]);
  };
}

// POST /api/host/imessage/connection { phone } → PhoneLink
export function createPhoneLinkStartHandler(load: () => SetupRouteDependencies = setupRouteDependenciesFromEnvironment) {
  return createPhoneLinkCommandHandler(startPhoneLinkCommand, load);
}

// POST /api/host/imessage/connection/retry {} → PhoneLink
export function createPhoneLinkRetryHandler(load: () => SetupRouteDependencies = setupRouteDependenciesFromEnvironment) {
  return createPhoneLinkCommandHandler(retryPhoneLinkCommand, load);
}

// POST /api/host/imessage/notify { channel } → { channel }
export function createNotifyWhenBackHandler(load: () => SetupRouteDependencies = setupRouteDependenciesFromEnvironment) {
  return createPhoneLinkCommandHandler(notifyWhenBackCommand, load);
}
