// AI-generated with Codex (gpt-6-astra), 2026-10-05; Claude Code (claude-opus-5-5), 2026-10-05
'use client'
import type { ProfileDraftView } from '@/contracts/profile'
import { AlertIcon, Button, ChatBubble, ChatPending, SendIcon, Textarea } from '@/components/ui'
export function OnboardingChat({ messages, text, onText, onSend, disabled, pending = false }: { messages: ProfileDraftView['messages']; text: string; onText: (s: string) => void; onSend: () => void; disabled: boolean; pending?: boolean }) {
  return <section className="rounded-card border border-border bg-surface shadow-card" aria-label="설정 대화">
    <div className="border-b border-border px-4 pt-4 pb-3 sm:px-5">
      <h2 className="text-h3 font-semibold text-ink">말로 설명해도 좋아요</h2>
      <p className="mt-1 text-small text-muted">입력한 설명과 저장된 설정이 AI 해석에 사용돼요. AI를 사용하지 않고 직접 설정 영역에서 설정할 수도 있어요.</p>
    </div>
    <div role="log" aria-label="온보딩 대화" className="max-h-[28rem] min-h-24 space-y-4 overflow-y-auto bg-canvas/60 px-4 py-4 sm:px-5">
      {messages.length === 0 && !pending && <p className="py-4 text-center text-small text-muted">예: “평일 10시부터 5시까지 미팅 괜찮고, 점심 12–1시는 비워 주세요.”</p>}
      {messages.map(m => <ChatBubble key={m.id} from={m.role === 'user' ? 'user' : 'assistant'} name={m.role === 'user' ? '나' : '설정 도우미'}
        note={m.interpretFailed ? <p className="mt-1.5 flex items-center gap-1.5 px-1 text-caption font-medium text-warn-ink"><AlertIcon size={13} />해석하지 못했어요. 직접 입력하거나 다시 설명해 주세요.</p> : undefined}>
        <p className="whitespace-pre-wrap">{m.content}</p>
      </ChatBubble>)}
      {pending && <ChatPending>설정 도우미가 답을 정리하고 있어요…</ChatPending>}
    </div>
    <form onSubmit={e => { e.preventDefault(); if (!disabled && text.trim()) onSend() }} className="space-y-2 border-t border-border p-4 sm:px-5">
      <label className="block"><span className="mb-1.5 block text-small font-medium text-ink-soft">AI에게 설명하기</span><Textarea aria-label="AI에게 설명하기" maxLength={4000} value={text} onChange={e => onText(e.target.value)} /></label>
      <div className="flex justify-end"><Button type="submit" variant="primary" disabled={disabled || !text.trim()}><SendIcon />메시지 보내기</Button></div>
    </form>
  </section>
}
