import { z } from "zod"
import { body, fail, handle } from "@/server/api"
import { currentUser, db, now } from "@/server/context"
import { getOrCreateConversation } from "@/server/repos/conversations"
import { getUser } from "@/server/repos/users"
import { conversationState } from "@/server/services/chat"
import { isBookableHost } from "@/server/services/schedule"

export function POST(req: Request) {
  return handle(async () => {
    const { hostId } = await body(req, z.object({ hostId: z.string() }))
    const client = await currentUser()
    if (hostId === client.id || !(await getUser(db(), hostId))) return fail("not_found", "호스트를 찾을 수 없어요")
    if (!(await isBookableHost(db(), hostId))) return fail("not_bookable", "이 호스트는 아직 예약을 받을 수 없어요")
    const conv = await getOrCreateConversation(db(), client.id, hostId)
    return Response.json(await conversationState(db(), conv.id, client.id, now()))
  })
}
