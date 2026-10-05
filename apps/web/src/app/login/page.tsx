import {GoogleConnect} from '@/components/GoogleConnect'
import Link from 'next/link'
import {buttonClass} from '@/components/ui'
import {readServerConfig} from '@/server/config'
export const metadata = { title: '로그인' }

const STEPS = [
 {title:'Calendar 연결 (선택)', body:'읽기 전용으로 연결해 기존 일정과 겹치지 않게 해요. 연결하지 않고 직접 설정해도 돼요.'},
 {title:'시간 프로필', body:'AI가 지난 일정을 살펴보며 미팅 가능한 시간과 선호를 함께 정해요. 확정은 직접 해요.'},
 {title:'AI와 예약', body:'호스트를 고르고 대화하며 가능한 시간을 찾아요.'},
]

export default function LoginPage(){
 return (
  <main id="main" className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-12 sm:px-6">
   <div className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr]">
    <section className="space-y-6">
     <p className="text-small font-semibold text-primary">AI 미팅 예약</p>
     <h1 className="text-display font-bold text-ink sm:text-[2.5rem] sm:leading-[3rem]">나에게 맞는 미팅 시간</h1>
     <p className="max-w-md text-lead text-muted">Calendar를 연결하면 AI가 일정을 살펴보고, 미팅 가능한 시간과 선호를 함께 정해요. 연결은 선택이에요.</p>
     <div>{readServerConfig().mode==='real'?<GoogleConnect returnPath="/"/>:<Link href="/book" className={buttonClass('primary','lg')}>데모 시작</Link>}</div>
    </section>
    <ol className="space-y-3" aria-label="시작하는 순서">
     {STEPS.map((s,i)=>(
      <li key={s.title} className="flex gap-4 rounded-card border border-border bg-surface p-4 shadow-card">
       <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-small font-bold text-primary-soft-ink tabular">{i+1}</span>
       <div><p className="font-semibold text-ink">{s.title}</p><p className="text-small text-muted">{s.body}</p></div>
      </li>
     ))}
    </ol>
   </div>
  </main>
 )
}
