import {currentUser,db} from '@/server/context'
import {makeContext} from '@/server/runtime'
import {getProfile,currentDraft} from '@/server/services/profile'
import {OnboardingEntry} from '@/components/onboarding/OnboardingEntry'
import {WeekSchedule} from '@/components/onboarding/WeekSchedule'
import {Badge} from '@/components/ui'
export const metadata = { title: '내 시간 프로필' }
export default async function AvailabilityPage(){const user=await currentUser(),profile=await getProfile(db(),user.id);return <div className="space-y-8">{profile&&<section className="space-y-4"><div className="flex flex-wrap items-center gap-3"><h1 className="text-h2 font-bold text-ink">적용 중인 시간 프로필 · 버전 <span className="tabular">{profile.version}</span></h1><Badge tone="success">적용 중</Badge></div><WeekSchedule values={profile.values}/></section>}<OnboardingEntry initialDraft={await currentDraft(db(),user.id)} purpose="edit"/></div>}
