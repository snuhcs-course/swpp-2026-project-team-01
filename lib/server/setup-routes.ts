import { z } from "zod";
import type { CommandErrorCategory } from "../contracts/command-errors";
import { SETUP_OPERATIONS } from "../contracts/setup";
import { analyzeAgainCommand, setUpManuallyCommand } from "./analysis";
import { saveCalendarRolesCommand } from "./calendar-roles";
import { authenticatedUserId, chatError, json } from "./chat-routes";
import { type Actor, type CommandDefinition, type CommandOutcome, runCommand } from "./commands";
import { CalendarAccessError, type CalendarListEntry, openHostCalendar } from "./google-calendar";
import { checkHandle } from "./handles";
import { HostIneligibleError, readHostStanding } from "./host-eligibility";
import { type AppOrigins, appOriginsFromEnvironment, crossSiteRefusal } from "./same-origin";
import { readSetupState, type SetupDependencies, setupDependenciesFromEnvironment } from "./setup";
import { confirmSettingsCommand, updateDraftCommand } from "./setup-commands";
import { type SupabaseAuthConfig, supabaseAuthConfigFromEnvironment } from "./supabase-auth";

// Web routes for the setup cards (design decision 11), shaped like the chat
// routes: each authenticates the Supabase session itself, refuses a host that may
// not host, answers private, uncached JSON, and never trusts a client-supplied
// actor, step or link.

export type SetupRouteDependencies = SetupDependencies &
  AppOrigins & {
    readonly auth: SupabaseAuthConfig;
  };

export function setupRouteDependenciesFromEnvironment(): SetupRouteDependencies {
  return { ...appOriginsFromEnvironment(), ...setupDependenciesFromEnvironment(), auth: supabaseAuthConfigFromEnvironment() };
}

function unauthenticated() {
  return json({ code: "authentication_required", error: "Sign in to continue." }, 401);
}

// The signed-in host's actor, or the response refusing the request.
async function eligibleHost(request: Request, deps: SetupRouteDependencies): Promise<Actor | Response> {
  const userId = await authenticatedUserId(request, deps.auth);

  if (!userId) return unauthenticated();

  const standing = await readHostStanding(deps.db, userId);

  if (!standing.eligible || !standing.hostAccountId) {
    return chatError(new HostIneligibleError(standing.nextAction ?? "sign_in"));
  }

  return { id: standing.hostAccountId, kind: "host_account" };
}

// GET /api/setup/state?tz=<IANA>[&calendars=1]: the derived setup state for the cards.
export function createSetupStateHandler(load: () => SetupRouteDependencies = setupRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const actor = await eligibleHost(request, deps);

    if (actor instanceof Response) return actor;

    const url = new URL(request.url);
    const state = await readSetupState(deps, actor.id, {
      browserTimeZone: url.searchParams.get("tz"),
      includeCalendars: url.searchParams.get("calendars") === "1",
    });

    return state ? json(state) : chatError(new HostIneligibleError("sign_in"));
  };
}

const COMMAND_STATUS: Readonly<Record<CommandErrorCategory, number>> = {
  forbidden: 403,
  internal: 500,
  invalid_input: 400,
  retry_conflict: 409,
  stale_revision: 409,
  unauthenticated: 401,
  unavailable_configuration: 503,
};

const commandBody = z.object({
  operation: z.enum(SETUP_OPERATIONS),
  expectedRevision: z.number().int().min(0).nullable().optional(),
  retryKey: z.string().min(1).max(200),
  input: z.unknown(),
});

// The live calendar list, which saving roles and confirming check against.
async function liveCalendars(deps: SetupRouteDependencies, hostAccountId: string): Promise<CalendarListEntry[]> {
  const calendar = await openHostCalendar(deps.calendar, hostAccountId);
  return (await calendar.listCalendars()).calendars;
}

// POST /api/setup/commands { operation, expectedRevision, retryKey, input }
export function createSetupCommandHandler(load: () => SetupRouteDependencies = setupRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });

    if (refused) return refused;

    const actor = await eligibleHost(request, deps);

    if (actor instanceof Response) return actor;

    const body = commandBody.safeParse(await request.json().catch(() => null));

    if (!body.success) {
      return json({ code: "invalid_request", error: "Send an operation, a retry key and its input." }, 400);
    }

    const run = <Input, Result>(command: CommandDefinition<Input, Result>) =>
      runCommand({ authenticate: async () => actor, db: deps.db }, command, {
        expectedRevision: body.data.expectedRevision ?? null,
        input: body.data.input,
        resourceId: actor.id,
        retryKey: body.data.retryKey,
      });
    let outcome: CommandOutcome<unknown>;

    try {
      switch (body.data.operation) {
        case "setup.save_calendar_roles":
          outcome = await run(saveCalendarRolesCommand(await liveCalendars(deps, actor.id)));
          break;
        case "setup.confirm_settings":
          outcome = await run(confirmSettingsCommand(await liveCalendars(deps, actor.id), deps.appOrigin));
          break;
        case "setup.analyze_again":
          outcome = await run(analyzeAgainCommand);
          break;
        case "setup.set_up_manually":
          outcome = await run(setUpManuallyCommand);
          break;
        case "setup.update_draft":
          outcome = await run(updateDraftCommand);
          break;
      }
    } catch (error) {
      // Only the live calendar read throws here; runCommand reports its own failures.
      if (error instanceof CalendarAccessError) {
        return json({ code: error.category, error: error.message }, error.category === "calendar_unavailable" ? 503 : 409);
      }
      throw error;
    }

    return outcome.ok ? json(outcome) : json(outcome, COMMAND_STATUS[outcome.error.category]);
  };
}

// GET /api/setup/handle?candidate=: whether the host could take this handle now.
export function createHandleCheckHandler(load: () => SetupRouteDependencies = setupRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const actor = await eligibleHost(request, deps);

    if (actor instanceof Response) return actor;

    const candidate = new URL(request.url).searchParams.get("candidate") ?? "";

    if (candidate.length > 64) return json({ availability: "format", handle: candidate.toLowerCase() });

    return json(await checkHandle(deps.db, actor.id, candidate));
  };
}
