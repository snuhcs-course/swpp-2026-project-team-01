"use client"

import Link from "next/link"
import { useState } from "react"
import type { OptionView } from "@/server/repos/conversations"
import { call } from "./api"

const MAX = 500

export function RequestModal({ hostId, hostName, option, onClose }: { hostId: string; hostName: string; option: OptionView; onClose: () => void }) {
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await call("POST", "/api/requests", {
      hostId,
      startMs: option.startMs,
      placeId: option.placeId,
      meetingTypeId: option.meetingTypeId,
      message,
    })
    setBusy(false)
    if (res.ok) setSent(true)
    else setError(res.error)
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="예약 요청">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        {sent ? (
          <div>
            <h2 className="text-lg font-semibold">요청을 보냈어요</h2>
            <p className="mt-2 text-sm text-slate-600">{hostName}님이 수락하면 캘린더에 일정이 추가돼요.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
                닫기
              </button>
              <Link href="/requests/sent" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white">
                내 요청 보기
              </Link>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-semibold">{hostName}님께 요청</h2>
            <p className="mt-1 rounded-md bg-slate-100 px-3 py-2 text-sm">{option.label}</p>
            <label className="mt-4 block text-sm font-medium" htmlFor="request-message">
              보낼 메시지
            </label>
            <textarea
              id="request-message"
              value={message}
              maxLength={MAX}
              rows={4}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="예: 프로젝트 관련 상담을 드리고 싶습니다."
              className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
            />
            <div className="text-right text-xs text-slate-400">
              {message.length}/{MAX}
            </div>
            {error && (
              <p role="alert" className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
                {error ? "대화로 돌아가기" : "취소"}
              </button>
              <button
                type="button"
                disabled={busy || message.trim().length === 0}
                onClick={submit}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                요청 보내기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
