"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import type { RequestView } from "@/server/services/booking"
import {z} from 'zod'
import {request} from './api'
import {useMutationOperation} from './hooks/useMutationOperation'
import {requestViewSchema} from '@/contracts/booking'
const previewSchema=z.object({requestId:z.string(),revision:z.number(),affectedIds:z.array(z.string()),impactToken:z.string()})
const acceptedSchema=z.object({request:requestViewSchema,declinedIds:z.array(z.string()),eventIds:z.array(z.string())})
import { RequestSummary } from "./RequestCard"
import { Alert, Button, cardClass, cn, Spinner } from "./ui"

export function InboxGroup({ group }: { group: RequestView[] }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading,setLoading]=useState(false)
  const [preview,setPreview]=useState<z.infer<typeof previewSchema>|null>(null)
  const op=useMutationOperation<unknown>()
  const busy=loading||op.pending
  const done=(res:Awaited<ReturnType<typeof op.run>>)=>{if(res?.ok){setConfirming(null);setPreview(null);router.refresh()}else if(res){setError(res.error.message);if(res.error.code==='accept_impact_changed'){setConfirming(null);setPreview(null)}}}
  async function prepare(id:string){setLoading(true);setError(null);const result=await request('GET',`/api/requests/${id}/accept-preview`,previewSchema);setLoading(false);if(result.ok){setPreview(result.data);setConfirming(id)}else setError(result.error.message)}

  async function act(id: string, action: "accept" | "decline") {
    setError(null)
    const row=group.find(r=>r.id===id)!
    done(await op.run({method:'POST',url:`/api/requests/${id}/${action}`,kind:`request.${action}`,payload:action==='accept'?{expectedRevision:preview?.revision,impactToken:preview?.impactToken}:{expectedRevision:row.revision},schema:action==='accept'?acceptedSchema:requestViewSchema}))
  }

  return (
    <section className={cn(cardClass, "p-4 sm:p-5", group.length > 1 && "border-l-4 border-l-warn")}>
      {group.length > 1 && <p className="mb-3 text-small font-semibold text-warn-ink">같은 시간대에 {group.length}건이 겹쳐 있어요. 하나를 수락하면 나머지는 자동 거절돼요.</p>}
      {op.phase==='reconciling'&&<Button size="sm" className="mb-3" onClick={()=>void op.recover().then(done)}>처리 결과 확인</Button>}
      {error && <Alert tone="danger" role="alert" className="mb-3">{error}</Alert>}
      <ul className="divide-y divide-border">
        {group.map((r) => (
          <li key={r.id} className="py-4 first:pt-0 last:pb-0">
            <RequestSummary name={r.clientName} label={r.label} status={r.status} message={r.message} />
            {confirming === r.id ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-control bg-surface-sunken p-3 text-small">
                <span className="mr-auto font-medium text-ink">{preview?.affectedIds.length ? `겹치는 요청 ${preview.affectedIds.length}건은 자동 거절됩니다.` : "이 요청을 수락할까요?"}</span>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => act(r.id, "accept")}>{op.pending&&<Spinner/>}확인</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>취소</Button>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" disabled={busy} onClick={() => void prepare(r.id)}>{loading&&<Spinner/>}수락</Button>
                <Button disabled={busy} onClick={() => act(r.id, "decline")}>거절</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
