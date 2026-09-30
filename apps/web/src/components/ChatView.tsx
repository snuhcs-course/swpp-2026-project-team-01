"use client"

import { useEffect, useRef, useState } from "react"
import type { Chip } from "@/core/chips"
import type { FilterKey } from "@/core/types"
import type { MessageView, OptionView } from "@/server/repos/conversations"
import type { ConversationState, FilterResult, TurnResult } from "@/server/services/chat"
import { call } from "./api"
import { FilterChips } from "./FilterChips"
import { OptionButtons } from "./OptionButtons"
import { RequestModal } from "./RequestModal"

export function ChatView({ hostId, hostName, initial }: { hostId: string; hostName: string; initial: ConversationState }) {
  const [messages, setMessages] = useState<MessageView[]>(initial.messages)
  const [chips, setChips] = useState<Chip[]>(initial.chips)
  const [count, setCount] = useState(initial.count)
  const [tray, setTray] = useState<OptionView[] | null>(null)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<"unavailable" | "unparseable" | null>(null)
  const [picked, setPicked] = useState<OptionView | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [messages, tray, busy])

  async function send() {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    setBanner(null)
    setTray(null)
    const optimistic: MessageView = { id: `tmp-${Date.now()}`, role: "user", content: value, options: null, createdAt: new Date().toISOString() }
    setMessages((m) => [...m, optimistic])
    setText("")
    const res = await call<TurnResult>("POST", `/api/conversations/${initial.conversationId}/turns`, { text: value })
    setBusy(false)
    if (!res.ok) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id))
      setText(value)
      setError(res.error)
      return
    }
    const d = res.data
    setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), d.userMessage, d.assistantMessage])
    setChips(d.chips)
    setCount(d.count)
    setBanner(d.llmUnavailable ? "unavailable" : d.interpretFailed ? "unparseable" : null)
  }

  async function removeChip(key: FilterKey) {
    setBusy(true)
    setError(null)
    const res = await call<FilterResult>("PATCH", `/api/conversations/${initial.conversationId}/filter`, { remove: key })
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setChips(res.data.chips)
    setCount(res.data.count)
    setTray(res.data.options)
  }

  // Buttons stay under the latest message that carried them, even if later replies show none.
  const lastOptionsId = [...messages].reverse().find((m) => m.role === "assistant" && m.options)?.id

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold">{hostName}님과 미팅</h1>
        <p className="text-sm text-slate-500">
          조건에 맞는 시간 <strong data-testid="slot-count">{count}</strong>개
        </p>
      </div>
      <FilterChips chips={chips} onRemove={removeChip} disabled={busy} />
      {banner === "unavailable" && (
        <p role="status" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900">
          AI 응답을 받지 못했어요. 잠시 후 다시 시도하거나, 위쪽 조건 칩으로 직접 조정할 수 있어요.
        </p>
      )}
      {banner === "unparseable" && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          AI가 말씀을 해석하지 못했어요. 위쪽 조건 칩으로 직접 조정하거나 다시 말씀해 주세요.
        </p>
      )}

      <div className="flex min-h-[18rem] flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400">예: “다음 주 평일 오후에 온라인이면 좋겠어. 금요일은 안 돼.”</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "self-end" : "self-start"}>
            <div className={`max-w-md whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-indigo-600 text-white" : "bg-slate-100"}`}>{m.content}</div>
            {m.options && m.id === lastOptionsId && !tray && <OptionButtons options={m.options} onPick={setPicked} />}
          </div>
        ))}
        {tray && (
          <div className="self-start">
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-sm">조건을 바꿨어요. 지금 조건의 추천 후보예요.</div>
            <OptionButtons options={tray} onPick={setPicked} />
          </div>
        )}
        {busy && <div className="self-start text-sm text-slate-400">답변을 만드는 중…</div>}
        <div ref={endRef} />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="원하는 시간을 말씀해 주세요"
          aria-label="메시지 입력"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy || text.trim().length === 0} className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-40">
          보내기
        </button>
      </form>

      {picked && <RequestModal hostId={hostId} hostName={hostName} option={picked} onClose={() => setPicked(null)} />}
    </div>
  )
}

