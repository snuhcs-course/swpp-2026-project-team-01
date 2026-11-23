import { authenticatedUserId, json } from "@lib/server/chat-routes";
import { database } from "@lib/server/database";
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

  await db.begin(async (tx) => {
    await tx`select id from app.host_accounts where id = ${standing.hostAccountId} for update`;
    await tx`delete from app.provider_grants where host_account_id = ${standing.hostAccountId}`;
    await tx`delete from app.calendar_roles where host_account_id = ${standing.hostAccountId}`;
    await tx`delete from app.calendar_note_decisions where host_account_id = ${standing.hostAccountId}`;
    await tx`
      update app.host_settings
      set settings = settings - array['bookingCalendar', 'conflictCalendars', 'noteExclusions']::text[],
          revision = revision + 1, updated_at = now()
      where host_account_id = ${standing.hostAccountId}
    `;
  });
  return json({ disconnected: true });
}
