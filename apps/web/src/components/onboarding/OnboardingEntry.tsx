"use client"
import {useState} from 'react'
import {profileDraftViewSchema,type ProfileDraftView} from '@/contracts/profile'
import {useMutationOperation} from '@/components/hooks/useMutationOperation'
import {Alert,Button,Card,Spinner} from '@/components/ui'
import {OnboardingWorkspace} from './OnboardingWorkspace'
export function OnboardingEntry({initialDraft,purpose='onboarding'}:{initialDraft:ProfileDraftView|null;purpose?:'onboarding'|'edit'}){
 const [draft,setDraft]=useState(initialDraft),[error,setError]=useState<string|null>(null),op=useMutationOperation<ProfileDraftView>()
 const accept=(r:Awaited<ReturnType<typeof op.run>>)=>{if(r?.ok)setDraft(r.data);else if(r)setError(r.error.message)}
 if(draft)return <OnboardingWorkspace initialDraft={draft}/>
 return <Card className="max-w-2xl space-y-5 p-6 sm:p-8">
  <div className="space-y-2"><h1 className="text-h1 font-bold text-ink">시간 프로필 설정</h1><p className="text-muted">근무시간, 미팅을 허용할 시간, 추가 선호를 직접 입력하거나 AI와 대화하며 설정해요. 마지막 확인 전까지는 초안으로만 저장돼요.</p></div>
  {error&&<Alert tone="danger" role="alert">{error}</Alert>}
  <div className="flex flex-wrap gap-2"><Button variant="primary" size="lg" disabled={op.pending} onClick={()=>void op.run({method:'POST',url:'/api/profile-drafts',kind:'profile.draft.create',payload:{purpose},schema:profileDraftViewSchema}).then(accept)}>{op.pending&&<Spinner/>}설정 시작</Button>{op.phase==='reconciling'&&<Button size="lg" onClick={()=>void op.recover().then(accept)}>결과 확인</Button>}</div>
 </Card>
}
