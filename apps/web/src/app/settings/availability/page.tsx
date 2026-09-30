import { AvailabilityForm } from "@/components/AvailabilityForm"
import { currentUser, db } from "@/server/context"
import { getRules } from "@/server/repos/users"

export default async function AvailabilityPage() {
  const me = await currentUser()
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">가능 시간</h1>
      <p className="mb-4 text-sm text-slate-500">미팅에 있을 수 있는 시간이에요. 이 시간 밖에는 미팅이 잡히지 않아요. (기본 매일 08:00–22:00)</p>
      <AvailabilityForm key={me.id} initial={await getRules(db(), me.id)} />
    </div>
  )
}
