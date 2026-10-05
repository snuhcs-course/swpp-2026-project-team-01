import {currentUser,db} from '@/server/context'
import Link from 'next/link'
import {currentDraft} from '@/server/services/profile'
import {readCalendarConnection} from '@/server/services/calendar-sync'
import {OnboardingEntry} from '@/components/onboarding/OnboardingEntry'
import {Alert,buttonClass,CalendarIcon} from '@/components/ui'
export const metadata = { title: '시간 프로필 설정' }
export default async function OnboardingPage({searchParams}:{searchParams:Promise<{analyze?:string}>}){const {analyze}=await searchParams,user=await currentUser(),calendar=await readCalendarConnection(db(),user.id),imported=!!calendar.analysis&&calendar.status==='connected';return <div className="space-y-6">{!imported&&<Alert tone="primary" icon={<CalendarIcon/>}><p><Link href="/settings/calendars" className={buttonClass('link')}>Calendar를 연결해 일정부터 가져오기</Link> · 연결 없이 직접 설정할 수도 있어요.</p></Alert>}<OnboardingEntry initialDraft={await currentDraft(db(),user.id)} autoAnalyze={analyze==='1'} calendarImported={imported}/></div>}
