import { SentRequests } from "@/components/SentRequests"
import { currentUser, db, now } from "@/server/context"
import { sentRequests } from "@/server/services/booking"

export default async function SentPage() {
  const me = await currentUser()
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">내 요청</h1>
      <SentRequests requests={await sentRequests(db(), me.id, now())} />
    </div>
  )
}
