import { InboxGroup } from "@/components/InboxGroup"
import { StatusBadge } from "@/components/StatusBadge"
import { currentUser, db, now } from "@/server/context"
import { inbox, type RequestView } from "@/server/services/booking"

function Done({ title, items }: { title: string; items: RequestView[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <h2 className="mb-2 mt-6 font-medium">{title}</h2>
      <ul className="space-y-2">
        {items.map((r) => (
          <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.clientName}</span>
              <StatusBadge status={r.status} />
            </div>
            <p className="mt-1">{r.label}</p>
            <p className="mt-1 whitespace-pre-wrap text-slate-600">{r.message}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default async function InboxPage() {
  const me = await currentUser()
  const box = await inbox(db(), me.id, now())
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">받은 요청함</h1>
      {box.pendingGroups.length === 0 ? (
        <p className="text-sm text-slate-400">대기 중인 요청이 없어요.</p>
      ) : (
        <div className="space-y-3">
          {box.pendingGroups.map((g) => (
            <InboxGroup key={g.map((r) => r.id).join("-")} group={g} />
          ))}
        </div>
      )}
      <Done title="수락한 요청" items={box.accepted} />
      <Done title="거절·철회된 요청" items={box.declined} />
      <Done title="만료된 요청" items={box.expired} />
    </div>
  )
}
