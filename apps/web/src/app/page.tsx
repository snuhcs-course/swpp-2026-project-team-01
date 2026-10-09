// AI-generated with Claude Code (claude-sonnet-5-5), 2026-09-29; Claude Code (claude-opus-5-5), 2026-10-05
import { redirect } from "next/navigation"
import { currentUser, db } from "@/server/context"
import { getProfile } from "@/server/services/profile"

/** After sign-in: people who have not set up their hours start at the calendar step; everyone else goes to booking. */
export default async function Home() {
  const user = await currentUser()
  redirect((await getProfile(db(), user.id)) ? "/book" : "/settings/calendars")
}
