import { SentRequests } from "@/components/SentRequests"
import { PageHeader } from "@/components/ui"
import { currentUser, db, now } from "@/server/context"
import { sentRequests } from "@/server/services/booking"
import { makeContext } from "@/server/runtime"
import { conflictingRequestIds } from "@/server/services/schedule-view"
import { weekIndexFor } from "@/core/week"
export const metadata = { title: '내 요청' }

export default async function SentPage() {
  const me = await currentUser()
  const requests = await sentRequests(db(), me.id, now())
  const clash = new Set(await conflictingRequestIds(makeContext(db()), me.id))
  const conflicts = Object.fromEntries(requests.filter((r) => r.status === "accepted" && clash.has(r.id)).map((r) => [r.id, `/calendar?w=${weekIndexFor(r.startMs, now())}`]))
  return (
    <div>
      <PageHeader eyebrow="예약" title="내 요청" description="내가 보낸 미팅 요청과 진행 상태예요. 대기 중인 요청은 철회할 수 있어요." />
      <SentRequests requests={requests} conflicts={conflicts} />
    </div>
  )
}
