import { createHostSkillHandler } from "@lib/server/public-routes";
import { connection } from "next/server";

const handle = createHostSkillHandler();

export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }) {
  // Never prerendered: the document follows the host's current readiness.
  await connection();
  return handle(request, (await params).handle);
}
