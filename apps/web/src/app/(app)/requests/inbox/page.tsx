import Link from "next/link"
import { InboxGroup } from "@/components/InboxGroup"
import { RequestCard, RequestSummary } from "@/components/RequestCard"
import { buttonClass, EmptyState, PageHeader, CheckIcon } from "@/components/ui"
import { currentUser, db, now } from "@/server/context"
import { inbox, type RequestView } from "@/server/services/booking"
import { makeContext } from "@/server/runtime"
import { conflictingRequestIds } from "@/server/services/schedule-view"
import { listMeetingTypes, listPlaces } from "@/server/repos/hosting"
import { weekIndexFor } from "@/core/week"
export const metadata = { title: '받은 요청함' }

function Done({ title, items, conflicts = {} }: { title: string; items: RequestView[]; conflicts?: Record<string, string> }) {
  if (items.length === 0) return null
  return (
    <section className="mt-10">
      <h2 className="mb-3 flex items-center gap-2 text-h3 font-semibold text-ink">
        {title}
        <span className="text-small font-medium text-muted tabular">{items.length}</span>
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((r) => (
          <RequestCard key={r.id}>
            <RequestSummary name={r.clientName} label={r.label} status={r.status} message={r.message} conflictHref={conflicts[r.id]} />
          </RequestCard>
        ))}
      </ul>
    </section>
  )
}

export default async function InboxPage() {
  const me = await currentUser()
  const box = await inbox(db(), me.id, now())
  const hosting = (await listPlaces(db(), me.id)).length > 0 && (await listMeetingTypes(db(), me.id)).length > 0
  const clash = new Set(await conflictingRequestIds(makeContext(db()), me.id))
  const conflicts = Object.fromEntries(box.accepted.filter((r) => clash.has(r.id)).map((r) => [r.id, `/calendar?w=${weekIndexFor(r.startMs, now())}`]))
  return (
    <div>
      <PageHeader eyebrow="예약" title="받은 요청함" description="다른 사람이 보낸 미팅 요청을 수락하거나 거절해요." />
      {box.pendingGroups.length === 0 ? (
        <EmptyState
          compact
          icon={<CheckIcon size={20} />}
          title="대기 중인 요청이 없어요."
          description={hosting ? "새 요청이 오면 여기에 표시돼요." : "장소와 미팅 양식을 등록해 두면 다른 사람이 나에게 요청을 보낼 수 있어요."}
          actions={hosting ? undefined : <Link href="/settings/host" className={buttonClass("secondary", "sm")}>호스트 설정</Link>}
        />
      ) : (
        <div className="space-y-3">
          <h2 className="sr-only">대기 중인 요청</h2>
          {box.pendingGroups.map((g) => (
            <InboxGroup key={g.map((r) => r.id).join("-")} group={g} />
          ))}
        </div>
      )}
      <Done title="수락한 요청" items={box.accepted} conflicts={conflicts} />
      <Done title="거절·철회된 요청" items={box.declined} />
      <Done title="만료된 요청" items={box.expired} />
    </div>
  )
}
