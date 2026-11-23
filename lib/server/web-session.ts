import { authenticatedUserId, chatDependenciesFromEnvironment } from "./chat-routes";
import { openSetupSession } from "./conversations";
import { database } from "./database";
import { type HostStanding, readHostStanding } from "./host-eligibility";
import { supabaseAuthConfigFromEnvironment } from "./supabase-auth";

export type HostWorkspace = HostStanding & {
  // Opens the eligible host's authorized empty setup session through the
  // application, so the conversation exists before the host's first messenger
  // message. Only the workspace page waits for it; the notes page and the
  // dashboard do not. If the agent service is unreachable the page
  // still renders; the first message opens the session instead.
  readonly openSetupSession: () => Promise<void>;
};

// The signed-in host's standing for the /app pages, from the request's Supabase
// session cookie, null when no valid session exists.
export async function openHostWorkspace(cookie: string): Promise<HostWorkspace | null> {
  const request = new Request("http://localhost/", { headers: { cookie } });
  const userId = await authenticatedUserId(request, supabaseAuthConfigFromEnvironment());

  if (!userId) return null;

  const standing = await readHostStanding(database(), userId);

  return {
    ...standing,
    openSetupSession: async () => {
      if (!standing.eligible || !standing.hostAccountId) return;
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
    },
  };
}
