// AI-generated with Claude Code (claude-opus-5-5), 2026-10-05; Codex (gpt-6-astra), 2026-10-05
import Link from 'next/link'
import { DomainError } from '@/contracts/common'
import { GoogleConnect } from '@/components/GoogleConnect'
import { AcceptInviteButton } from '@/components/InviteLink'
import { buttonClass, Card } from '@/components/ui'
import { readServerConfig } from '@/server/config'
import { getDb } from '@/server/db/client'
import { requireActor } from '@/server/session'
import { inviter } from '@/server/services/contacts'
export const metadata = { title: '미팅 예약 링크' }

/** A booking link. Signed-in visitors add the host with one click; others sign in first and come back here. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const host = await inviter(getDb(), token)
  const me = await requireActor().catch((e) => { if (e instanceof DomainError && e.code === 'unauthenticated') return null; throw e })
  const real = readServerConfig().mode === 'real'
  return (
    <main id="main" className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-12">
      <Card className="space-y-5 p-6 sm:p-8">
        {!host ? <>
          <h1 className="text-h1 font-bold text-ink">링크를 열 수 없어요</h1>
          <p className="text-muted">링크가 잘못됐거나, 보낸 사람이 새 링크로 바꿨어요. 새 링크를 다시 받아 주세요.</p>
          <Link href="/" className={buttonClass('secondary')}>처음으로</Link>
        </> : <>
          <p className="text-small font-semibold text-primary">AI 미팅 예약</p>
          <h1 className="text-h1 font-bold text-ink">{host.name}님이 미팅 예약 링크를 보냈어요</h1>
          {me?.id === host.id ? <>
            <p className="text-muted">내 예약 링크예요. 미팅을 요청받고 싶은 사람에게 보내 주세요.</p>
            <Link href="/settings/host" className={buttonClass('secondary')}>호스트 설정으로</Link>
          </> : me ? <>
            <p className="text-muted">연락처에 추가하면 {host.name}님과 서로의 가능한 시간을 맞춰 미팅을 요청할 수 있어요.</p>
            <AcceptInviteButton token={token} />
          </> : <>
            <p className="text-muted">로그인하면 {host.name}님이 연락처에 추가되고, 서로 가능한 시간을 AI와 함께 찾을 수 있어요.</p>
            {real ? <GoogleConnect returnPath={`/invite/${token}`} /> : <Link href="/login" className={buttonClass('primary', 'lg')}>시작</Link>}
          </>}
        </>}
      </Card>
    </main>
  )
}
