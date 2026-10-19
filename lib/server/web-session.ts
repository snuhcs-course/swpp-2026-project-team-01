import { authenticatedUserId, chatDependenciesFromEnvironment } from "./chat-routes";
import { openSetupSession } from "./conversations";
import { database } from "./database";
import { type HostStanding, readHostStanding } from "./host-eligibility";
import { supabaseAuthConfigFromEnvironment } from "./supabase-auth";

// The signed-in host's standing for the /app page, from the request's Supabase
// session cookie, null when no valid session exists. An eligible host's visit
// also opens its authorized empty setup session through the application, so the
// conversation exists before the first message. If the agent service is
// unreachable the page still renders; the message route opens the session on
// first use instead.
export async function openHostWorkspace(cookie: string): Promise<HostStanding | null> {
  const request = new Request("http://localhost/", { headers: { cookie } });
  const userId = await authenticatedUserId(request, supabaseAuthConfigFromEnvironment());

  if (!userId) return null;

  const standing = await readHostStanding(database(), userId);

  if (standing.eligible && standing.hostAccountId) {
    try {
      await openSetupSession(chatDependenciesFromEnvironment(), userId, {
        id: standing.hostAccountId,
        kind: "host_account",
      });
    } catch (error) {
      console.error(
        JSON.stringify({ error: error instanceof Error ? error.name : typeof error, event: "setup_session_unavailable" }),
      );
    }
  }

  return standing;
}
