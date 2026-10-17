// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17, 2026-10-18
import { HostOnboarding } from "@/components/thyme/host-onboarding";
import { readServerConfig } from "@/server/config";
import { currentUser, db } from "@/server/context";
import { hostChatView } from "@/server/services/host-chat";
import { getProfile } from "@/server/services/profile";
import { siteLocale } from "../locale";

// P03, the host's page. Signed-out visitors go back to the landing (currentUser redirects).
// The chat's first view is rendered here; after that the screen talks to /api/host-chat.
// Demo mode keeps no phone numbers, so `?phone=1` says the iMessage start already dealt with the number
// (checked it, or put it off).
export default async function HostPage({ searchParams }: { searchParams: Promise<{ calendar?: string; phone?: string }> }) {
  const user = await currentUser();
  const locale = await siteLocale();
  const demo = readServerConfig().mode === "demo";
  const [chat, profile, query] = await Promise.all([hostChatView(db(), user.id, locale), getProfile(db(), user.id), searchParams]);
  return (
    <HostOnboarding
      host={{ locale, name: user.name, demo, hasProfile: !!profile, phoneDone: demo && query.phone === "1", attachExampleCalendar: demo && query.calendar === "1" }}
      chat={chat}
    />
  );
}
