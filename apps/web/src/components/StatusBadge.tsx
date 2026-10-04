import { Badge, type Tone } from "./ui"

const TONE: Record<string, Tone> = {
  pending: "warn",
  accepted: "success",
  declined: "neutral",
  withdrawn: "neutral",
  expired: "neutral",
}
const LABEL: Record<string, string> = { pending: "대기 중", accepted: "수락됨", declined: "거절됨", withdrawn: "철회됨", expired: "만료" }

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONE[status] ?? "neutral"}>{LABEL[status] ?? status}</Badge>
}
