import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { readConnectLink } from "@lib/server/connect-link-routes";
import { imessageRouteDependenciesFromEnvironment } from "@lib/server/imessage-routes";
import { LinkCard } from "./link-card";

export const metadata: Metadata = { referrer: "same-origin", robots: { index: false, follow: false }, title: "Link your chat" };
export const instant = false;
export default async function Page({ params }: { readonly params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const cookie = (await cookies()).getAll().map(({ name, value }) => `${name}=${value}`).join("; ");
  const deps = imessageRouteDependenciesFromEnvironment();
  const view = await readConnectLink(deps, new Request(`${deps.appOrigin}/connect/link/${token}`, { headers: { cookie } }), token);
  return <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10"><LinkCard initial={view} token={token} /></main>;
}
