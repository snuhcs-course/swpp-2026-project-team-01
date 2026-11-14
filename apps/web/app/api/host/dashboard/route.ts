import { authenticatedUserId, json } from "@lib/server/chat-routes";
import { database } from "@lib/server/database";
import { googleCalendarConfigFromEnvironment } from "@lib/server/google-calendar";
import { readHostDashboard } from "@lib/server/host-dashboard";
import { readHostStanding } from "@lib/server/host-eligibility";
import { supabaseAuthConfigFromEnvironment } from "@lib/server/supabase-auth";
import { tokenKeyFromEnvironment } from "@lib/server/token-encryption";
import { connection } from "next/server";

export async function GET(request: Request) {
  await connection();
  const userId = await authenticatedUserId(request, supabaseAuthConfigFromEnvironment());
  if (!userId) return json({ error: "Sign in to continue." }, 401);
  const db = database();
  const standing = await readHostStanding(db, userId);
  if (!standing.eligible || !standing.hostAccountId) return json({ error: "Dashboard is unavailable for this account." }, 403);

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const start = from ? new Date(from) : null;
  const end = to ? new Date(to) : null;
  if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
      end <= start || end.getTime() - start.getTime() > 45 * 86_400_000) {
    return json({ error: "Choose a valid period of up to 45 days." }, 400);
  }

  return json(await readHostDashboard(
    db,
    { db, config: googleCalendarConfigFromEnvironment(), tokenKeys: [tokenKeyFromEnvironment()] },
    standing.hostAccountId,
    { start, end },
  ));
}
