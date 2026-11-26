import { database } from "@lib/server/database";
import { doneCount, findGroupByToken } from "@lib/server/group-meetings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { GroupStart } from "@/app/_components/guest/guest-start";

// A group meeting's shared link (group-scheduling: Shared link admits
// participants until full). It names the host and the meeting, then starts the
// participant's own request with Google; a full or closed group says so. An
// unknown token gets the neutral not-found page. The token is the only
// credential and is looked up by hash.
type Params = Promise<{ token: string }>;

export const metadata: Metadata = {
  referrer: "same-origin",
  robots: { follow: false, index: false },
  title: "Group meeting",
};

export default function Page({ params }: { readonly params: Params }) {
  return (
    <Suspense fallback={<p className="sr-only" role="status">Loading...</p>}>
      <Group params={params} />
    </Suspense>
  );
}

function rangeText(start: string, end: string, timeZone: string) {
  const format = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  const day = (date: string) => format.format(new Date(`${date}T00:00:00Z`));
  return `${start === end ? day(start) : `${day(start)} to ${day(end)}`} (${timeZone})`;
}

async function Group({ params }: { readonly params: Params }) {
  await connection();
  const { token } = await params;
  const db = database();
  const group = await findGroupByToken(db, token);

  if (!group) notFound();

  const [host] = await db<{ display_name: string | null }[]>`
    select settings ->> 'displayName' as display_name from app.host_settings where host_account_id = ${group.host_account_id}
  `;
  const open = group.state === "collecting" && (await doneCount(db, group.id)) < group.participant_limit;

  return (
    <GroupStart
      group={{
        durationMinutes: group.duration_minutes,
        hostName: host?.display_name ?? "Your host",
        open,
        purpose: group.purpose,
        range: rangeText(group.range_start, group.range_end, group.timezone),
        token,
      }}
    />
  );
}
