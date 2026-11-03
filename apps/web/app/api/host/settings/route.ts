import { authenticatedUserId, json } from "@lib/server/chat-routes";
import { runCommand } from "@lib/server/commands";
import { database } from "@lib/server/database";
import { readHostStanding } from "@lib/server/host-eligibility";
import { readHostIntake, setHostIntakeCommand } from "@lib/server/host-intake";
import { crossSiteRefusal, appOriginsFromEnvironment } from "@lib/server/same-origin";
import { supabaseAuthConfigFromEnvironment } from "@lib/server/supabase-auth";
import { connection } from "next/server";
import { z } from "zod";

async function host(request: Request) {
  const userId = await authenticatedUserId(request, supabaseAuthConfigFromEnvironment());
  if (!userId) return null;
  const standing = await readHostStanding(database(), userId);
  return standing.eligible ? standing.hostAccountId : null;
}

export async function GET(request: Request) {
  await connection();
  const id = await host(request);
  if (!id) return json({ error: "Sign in to continue." }, 401);
  return json(await readHostIntake(database(), id));
}

const bodySchema = z.object({ accepting: z.boolean(), revision: z.number().int().min(0), retryKey: z.uuid() }).strict();

export async function POST(request: Request) {
  const refused = crossSiteRefusal(request, appOriginsFromEnvironment(), { json: true });
  if (refused) return refused;
  const id = await host(request);
  if (!id) return json({ error: "Sign in to continue." }, 401);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "Invalid setting." }, 400);
  const result = await runCommand({ authenticate: async () => ({ kind: "host_account", id }), db: database() }, setHostIntakeCommand, {
    expectedRevision: body.data.revision,
    input: { accepting: body.data.accepting },
    resourceId: id,
    retryKey: body.data.retryKey,
  });
  return result.ok ? json(result.result) : json({ error: result.error.message, category: result.error.category }, result.error.category === "stale_revision" || result.error.category === "retry_conflict" ? 409 : 400);
}
