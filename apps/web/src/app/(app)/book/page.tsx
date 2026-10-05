import Link from "next/link"
import { currentUser, db } from "@/server/context"
import { listMeetingTypes, listPlaces } from "@/server/repos/hosting"
import { listUsers } from "@/server/repos/users"
import { contactIds } from "@/server/services/contacts"
import { AddContactForm } from "@/components/InviteLink"
import { Badge, buttonClass, cardClass, ChevronRightIcon, cn, EmptyState, PageHeader, UsersIcon } from "@/components/ui"
export const metadata = { title: '예약하기' }

const KIND_LABEL = { office_near: "회사 근처", special: "특정 장소", online: "온라인" } as const

export default async function BookPage() {
  const me = await currentUser()
  // Only people connected through a booking link are listed.
  const contacts = await contactIds(db(), me.id)
  const hosts = await Promise.all(
    (await listUsers(db()))
      .filter((u) => u.id !== me.id && contacts.has(u.id))
      .map(async (u) => ({ ...u, places: await listPlaces(db(), u.id), types: await listMeetingTypes(db(), u.id) })),
  )
  const bookableCount = hosts.filter((h) => h.places.length > 0 && h.types.length > 0).length

  return (
    <div>
      <PageHeader
        eyebrow="예약하기"
        title="누구와 만날까요?"
        description="호스트를 고르면 AI와 대화하며 가능한 시간을 찾을 수 있어요."
      />
      {(
        <section aria-label="연락처 추가" className="mb-6 space-y-2">
          <p className="text-small text-muted">상대에게 받은 예약 링크를 열거나 여기에 붙여 넣으면 서로 연락처에 추가돼요. 내 링크는 호스트 설정에서 복사할 수 있어요.</p>
          <AddContactForm />
        </section>
      )}
      {hosts.length === 0 || bookableCount === 0 ? (
        <EmptyState
          icon={<UsersIcon size={22} />}
          title={hosts.length === 0 ? "아직 연락처가 없어요" : "지금 예약을 받는 호스트가 없어요"}
          description={
            <>
              <p>{hosts.length === 0 ? "예약 링크로 추가한 사람이 여기에 나타나요." : "다른 사람이 호스트 설정에서 장소와 미팅 양식을 등록하면 이곳에 호스트로 나타나요."}</p>
              <p className="mt-1">나도 미팅 요청을 받으려면 호스트 설정을 먼저 해 주세요.</p>
            </>
          }
          actions={
            <>
              <Link href="/settings/host" className={buttonClass("primary")}>호스트 설정</Link>
              <Link href="/settings/availability" className={buttonClass("secondary")}>내 시간 프로필</Link>
            </>
          }
          className={hosts.length > 0 ? "mb-6" : undefined}
        />
      ) : null}
      {hosts.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {hosts.map((h) => {
            const bookable = h.places.length > 0 && h.types.length > 0
            const body = (
              <div
                className={cn(
                  cardClass,
                  "flex h-full flex-col gap-3 p-4 transition-colors",
                  bookable ? "group-hover:border-primary group-focus-visible:border-primary" : "border-dashed bg-surface-sunken shadow-none",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2.5">
                    <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary-soft-ink">
                      {h.name.slice(0, 1)}
                    </span>
                    <span className="font-semibold text-ink">{h.name}</span>
                  </span>
                  {bookable ? (
                    <ChevronRightIcon className="text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  ) : (
                    <Badge>예약 불가</Badge>
                  )}
                </div>
                {h.places.length > 0 && (
                  <div>
                    <p className="mb-1 text-caption text-muted">장소</p>
                    <div className="flex flex-wrap gap-1">
                      {h.places.map((p) => (
                        <Badge key={p.id} tone="primary">
                          {KIND_LABEL[p.kind]} · {p.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {h.types.length > 0 && (
                  <div>
                    <p className="mb-1 text-caption text-muted">미팅 양식</p>
                    <div className="flex flex-wrap gap-1">
                      {h.types.map((t) => (
                        <Badge key={t.id}>
                          {t.name} <span className="tabular">({t.durationMin}분)</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {!bookable && <p className="text-caption text-muted">장소와 미팅 양식을 모두 등록해야 예약을 받을 수 있어요.</p>}
              </div>
            )
            return (
              <li key={h.id}>
                {bookable ? (
                  <Link href={`/book/${h.id}`} className="group block h-full rounded-card">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
