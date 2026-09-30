import { HostSettings } from "@/components/HostSettings"
import { currentUser, db } from "@/server/context"
import { listMeetingTypes, listPlaces } from "@/server/repos/hosting"

export default async function HostSettingsPage() {
  const me = await currentUser()
  const places = await listPlaces(db(), me.id)
  const types = await listMeetingTypes(db(), me.id)
  const ready = places.length > 0 && types.length > 0
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">호스트 설정</h1>
      <p className="mb-4 text-sm text-slate-500">장소와 미팅 양식을 등록하면 다른 사람이 나에게 미팅을 요청할 수 있어요.</p>
      {!ready && (
        <p role="status" className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          현재 예약을 받을 수 없어요. 장소와 미팅 양식을 각각 하나 이상 등록해 주세요.
        </p>
      )}
      <HostSettings key={me.id} places={places} types={types} />
    </div>
  )
}
