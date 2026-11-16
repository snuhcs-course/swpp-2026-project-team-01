import { createWorkspaceRequestListHandler } from "@lib/server/host-request-routes";
import { connection } from "next/server";

const handle = createWorkspaceRequestListHandler();

export async function GET(request: Request) {
  await connection();
  return handle(request);
}
