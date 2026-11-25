import { authenticatedUserId, json } from "@lib/server/chat-routes";
import { database } from "@lib/server/database";
import { disconnectHostCalendar } from "@lib/server/host-calendar-disconnect";
import { readHostStanding } from "@lib/server/host-eligibility";
import { crossSiteRefusal, appOriginsFromEnvironment } from "@lib/server/same-origin";
import { supabaseAuthConfigFromEnvironment } from "@lib/server/supabase-auth";

export async function DELETE(request: Request) {
  const refused = crossSiteRefusal(request, appOriginsFromEnvironment(), { json: true });
  if (refused) return refused;
  const userId = await authenticatedUserId(request, supabaseAuthConfigFromEnvironment());
  if (!userId) return json({ error: "Sign in to continue." }, 401);
  const db = database();
  const standing = await readHostStanding(db, userId);
  if (!standing.eligible || !standing.hostAccountId) return json({ error: "Sign in to continue." }, 401);

  await db.begin((tx) => disconnectHostCalendar(tx, standing.hostAccountId!));
  return json({ disconnected: true });
}
