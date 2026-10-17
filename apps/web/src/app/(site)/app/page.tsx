// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17
import { HostOnboarding } from "@/components/thyme/host-onboarding";
import { readServerConfig } from "@/server/config";
import { currentUser, db } from "@/server/context";
import { listMeetingTypes, listPlaces } from "@/server/repos/hosting";
import { readCalendarConnection } from "@/server/services/calendar-sync";
import { inviteToken } from "@/server/services/contacts";
import { currentDraft, getProfile } from "@/server/services/profile";

// P03, the host's page. Signed-out visitors go back to the landing (currentUser redirects).
export default async function HostPage() {
  const user = await currentUser();
  const [draft, profile, calendar, token, places, types] = await Promise.all([
    currentDraft(db(), user.id), getProfile(db(), user.id), readCalendarConnection(db(), user.id),
    inviteToken(db(), user.id), listPlaces(db(), user.id), listMeetingTypes(db(), user.id),
  ]);
  return (
    <HostOnboarding host={{
      name: user.name,
      demo: readServerConfig().mode === "demo",
      draft,
      hasProfile: !!profile,
      calendar: calendar.status !== "connected" ? "none" : calendar.analysis ? "imported" : "connected",
      inviteToken: token,
      hostReady: places.length > 0 && types.length > 0,
    }} />
  );
}
