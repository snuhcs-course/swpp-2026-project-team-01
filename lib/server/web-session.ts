import { database } from "./database";
import { type HostStanding, readHostStanding } from "./host-eligibility";
import { createRequestAuthClient, supabaseAuthConfigFromEnvironment } from "./supabase-auth";

// The signed-in host's standing for a server-rendered page, from the request's
// Supabase session cookie. Null when no valid session exists.
export async function hostStandingFromCookies(cookie: string): Promise<HostStanding | null> {
  const request = new Request("http://localhost/", { headers: { cookie } });
  const { client } = createRequestAuthClient(request, supabaseAuthConfigFromEnvironment());
  const { data, error } = await client.auth.getUser();

  if (error || !data.user) return null;

  return readHostStanding(database(), data.user.id);
}
