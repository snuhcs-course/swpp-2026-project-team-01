"use client"
import { useEffect, useState } from "react"
import { z } from "zod"
import { useRouter } from "next/navigation"
import { request } from "./api"
import { Alert, Button, Card, Input, SectionHeader } from "./ui"

/** The host's own booking link: share it, or replace it if it went somewhere it should not. */
export function InviteLinkCard({ token: initial }: { token: string }) {
  const [token, setToken] = useState(initial), [origin, setOrigin] = useState(""), [note, setNote] = useState<string | null>(null), [busy, setBusy] = useState(false)
  useEffect(() => setOrigin(location.origin), [])
  const url = `${origin}/invite/${token}`
  return (
    <Card className="mb-6 space-y-3">
      <SectionHeader title="내 예약 링크" description="이 링크를 받은 사람이 열면 서로 연락처에 추가되고 나에게 미팅을 요청할 수 있어요." className="mb-0" />
      <div className="flex flex-wrap items-center gap-2">
        <Input readOnly value={url} aria-label="내 예약 링크" className="min-w-0 flex-1 basis-72" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="primary" onClick={async () => { try { await navigator.clipboard.writeText(url); setNote("링크를 복사했어요.") } catch { setNote("복사하지 못했어요. 링크를 직접 선택해 복사해 주세요.") } }}>링크 복사</Button>
        <Button disabled={busy} onClick={async () => {
          if (!confirm("새 링크로 바꾸면 지금 링크는 더 이상 열리지 않아요. 이미 추가된 연락처는 그대로예요. 바꿀까요?")) return
          setBusy(true); const r = await request("POST", "/api/invite-link", z.object({ token: z.string() }), {}); setBusy(false)
          if (r.ok) { setToken(r.data.token); setNote("새 링크로 바꿨어요.") } else setNote(r.error.message)
        }}>새 링크로 바꾸기</Button>
      </div>
      {note && <p role="status" className="text-small text-muted">{note}</p>}
    </Card>
  )
}

/** Paste a link someone sent (or just its code) to add them. */
export function AddContactForm() {
  const router = useRouter()
  const [value, setValue] = useState(""), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const token = value.trim().match(/([A-Za-z0-9_-]{24})\/?$/)?.[1]
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault(); if (!token) { setError("받은 예약 링크 전체를 붙여 넣어 주세요."); return }
      setBusy(true); setError(null)
      const r = await request("POST", "/api/contacts", z.object({ hostId: z.string(), hostName: z.string() }), { token })
      setBusy(false)
      if (r.ok) router.push(`/book/${encodeURIComponent(r.data.hostId)}`); else setError(r.error.message)
    }}>
      <div className="flex flex-wrap gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="받은 예약 링크 붙여넣기" aria-label="받은 예약 링크" className="min-w-0 flex-1 basis-72" />
        <Button type="submit" disabled={busy || !value.trim()}>연락처에 추가</Button>
      </div>
      {error && <Alert tone="danger" role="alert">{error}</Alert>}
    </form>
  )
}

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  return (
    <div className="space-y-2">
      <Button variant="primary" size="lg" disabled={busy} onClick={async () => {
        setBusy(true); setError(null)
        const r = await request("POST", "/api/contacts", z.object({ hostId: z.string(), hostName: z.string() }), { token })
        if (r.ok) router.push(`/book/${encodeURIComponent(r.data.hostId)}`); else { setError(r.error.message); setBusy(false) }
      }}>연락처에 추가하고 예약하기</Button>
      {error && <Alert tone="danger" role="alert">{error}</Alert>}
    </div>
  )
}
