"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import type { RequestView } from "@/server/services/booking"
import {useMutationOperation} from './hooks/useMutationOperation'
import {requestViewSchema,type RequestView as CommandRequestView} from '@/contracts/booking'
import { RequestCard, RequestSummary } from "./RequestCard"
import { Alert, Button, buttonClass, EmptyState, SendIcon } from "./ui"

/** `conflicts` maps a request id to the My Calendar link for its week, for confirmed meetings that now overlap an event on my calendar. */
export function SentRequests({ requests, conflicts = {} }: { requests: RequestView[]; conflicts?: Record<string, string> }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const op=useMutationOperation<CommandRequestView>()
  const done=(res:Awaited<ReturnType<typeof op.run>>)=>{if(res?.ok)router.refresh();else if(res)setError(res.error.message)}
  async function withdraw(id:string){setError(null);const r=requests.find(r=>r.id===id)!;done(await op.run({method:'POST',url:`/api/requests/${id}/withdraw`,kind:'request.withdraw',payload:{expectedRevision:r.revision},schema:requestViewSchema}))}

  if (requests.length === 0)
    return (
      <EmptyState
        icon={<SendIcon size={20} />}
        title="보낸 요청이 없어요."
        description="호스트를 골라 가능한 시간을 찾고 요청을 보내 보세요."
        actions={<Link href="/book" className={buttonClass("primary")}>예약하기</Link>}
      />
    )
  return (
    <div className="space-y-3">
      {op.phase==='reconciling'&&<Button size="sm" onClick={()=>void op.recover().then(done)}>철회 결과 확인</Button>}
      {error && <Alert tone="danger" role="alert">{error}</Alert>}
      <ul className="grid gap-3 md:grid-cols-2">
        {requests.map((r) => (
          <RequestCard key={r.id}>
            <RequestSummary name={r.hostName} label={r.label} status={r.status} message={r.message} conflictHref={conflicts[r.id]} />
            {r.status === "pending" && (
              <Button size="sm" variant="danger" className="mt-3" disabled={op.pending} onClick={() => withdraw(r.id)}>
                철회
              </Button>
            )}
          </RequestCard>
        ))}
      </ul>
    </div>
  )
}
