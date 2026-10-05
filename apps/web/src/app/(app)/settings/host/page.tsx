import { HostSettings } from "@/components/HostSettings"
import { Alert, Badge, PageHeader } from "@/components/ui"
import { currentUser, db } from "@/server/context"
import { listMeetingTypes, listPlaces } from "@/server/repos/hosting"
import { inviteToken } from "@/server/services/contacts"
import { readServerConfig } from "@/server/config"
import { InviteLinkCard } from "@/components/InviteLink"
export const metadata = { title: '호스트 설정' }

export default async function HostSettingsPage() {
  const me = await currentUser()
  const places = await listPlaces(db(), me.id)
  const types = await listMeetingTypes(db(), me.id)
  const ready = places.length > 0 && types.length > 0
  return (
    <div>
      <PageHeader
        eyebrow="설정"
        title="호스트 설정"
        description="장소와 미팅 양식을 등록하면 다른 사람이 나에게 미팅을 요청할 수 있어요."
        actions={ready ? <Badge tone="success">예약 받는 중</Badge> : <Badge tone="warn">예약 받을 수 없음</Badge>}
      />
      {!ready && (
        <Alert tone="warn" role="status" className="mb-6">
          현재 예약을 받을 수 없어요. 장소와 미팅 양식을 각각 하나 이상 등록해 주세요.
        </Alert>
      )}
      {readServerConfig().mode === "real" && <InviteLinkCard token={await inviteToken(db(), me.id)} />}
      <HostSettings key={me.id} places={places} types={types} />
    </div>
  )
}
