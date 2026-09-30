import { notFound, redirect } from "next/navigation"
import { currentUser, db, now } from "@/server/context"
import { getOrCreateConversation } from "@/server/repos/conversations"
import { getUser } from "@/server/repos/users"
import { conversationState } from "@/server/services/chat"
import { isBookableHost } from "@/server/services/schedule"
import { ChatView } from "@/components/ChatView"

export default async function HostChatPage({ params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = await params
  const me = await currentUser()
  if (hostId === me.id) redirect("/book")
  const host = await getUser(db(), hostId)
  if (!host) notFound()
  if (!(await isBookableHost(db(), hostId))) redirect("/book")

  const conv = await getOrCreateConversation(db(), me.id, hostId)
  const state = await conversationState(db(), conv.id, me.id, now())
  return <ChatView hostId={hostId} hostName={host.name} initial={state} />
}
