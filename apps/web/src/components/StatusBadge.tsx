const STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900",
  accepted: "bg-emerald-100 text-emerald-900",
  declined: "bg-slate-200 text-slate-700",
  withdrawn: "bg-slate-200 text-slate-700",
  expired: "bg-slate-100 text-slate-500",
}
const LABEL: Record<string, string> = { pending: "대기 중", accepted: "수락됨", declined: "거절됨", withdrawn: "철회됨", expired: "만료" }

export function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded px-2 py-0.5 text-xs ${STYLE[status] ?? ""}`}>{LABEL[status] ?? status}</span>
}
