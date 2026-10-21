import { createRootSkillHandler } from "@lib/server/public-routes";
import { connection } from "next/server";

const handle = createRootSkillHandler();

export async function GET(request: Request) {
  // Never prerendered: links follow the origin this request was addressed to.
  await connection();
  return handle(request);
}
