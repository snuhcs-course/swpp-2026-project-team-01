import Link from "next/link"
import { currentUser, db } from "@/server/context"
import { listMeetingTypes, listPlaces } from "@/server/repos/hosting"
import { listUsers } from "@/server/repos/users"

const KIND_LABEL = { office_near: "회사 근처", special: "특정 장소", online: "온라인" } as const

export default async function BookPage() {
  const me = await currentUser()
  const hosts = await Promise.all(
    (await listUsers(db()))
      .filter((u) => u.id !== me.id)
      .map(async (u) => ({ ...u, places: await listPlaces(db(), u.id), types: await listMeetingTypes(db(), u.id) })),
  )

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">누구와 만날까요?</h1>
      <p className="mb-5 text-sm text-slate-500">호스트를 고르면 AI와 대화하며 가능한 시간을 찾을 수 있어요.</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {hosts.map((h) => {
          const bookable = h.places.length > 0 && h.types.length > 0
          const body = (
            <div className={`rounded-lg border bg-white p-4 ${bookable ? "border-slate-200 hover:border-slate-400" : "border-dashed border-slate-300 opacity-60"}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{h.name}</span>
                {!bookable && <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">예약 불가</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {h.places.map((p) => (
                  <span key={p.id} className="rounded bg-sky-50 px-2 py-0.5 text-xs text-sky-800">
                    {KIND_LABEL[p.kind]} · {p.name}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {h.types.map((t) => (
                  <span key={t.id} className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                    {t.name} ({t.durationMin}분)
                  </span>
                ))}
              </div>
              {!bookable && <p className="mt-2 text-xs text-slate-500">장소와 미팅 양식을 모두 등록해야 예약을 받을 수 있어요.</p>}
            </div>
          )
          return <li key={h.id}>{bookable ? <Link href={`/book/${h.id}`}>{body}</Link> : body}</li>
        })}
      </ul>
    </div>
  )
}
