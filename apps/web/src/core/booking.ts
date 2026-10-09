// AI-generated with Claude Code (claude-sonnet-5-5), 2026-09-29
import type { RequestLike } from "./types"

export function intervalsOverlap(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs
}

/** A pending request whose start time has passed is treated as expired; nothing is stored for it. */
export function isExpired(req: RequestLike, nowMs: number): boolean {
  return req.status === "pending" && req.startMs < nowMs
}

export function isActivePending(req: RequestLike, nowMs: number): boolean {
  return req.status === "pending" && !isExpired(req, nowMs)
}

/** True when a new request would collide with one of the client's own pending requests (any host). */
export function overlapsOwnPending(
  ownRequests: RequestLike[],
  candidate: { startMs: number; endMs: number },
  nowMs: number,
): boolean {
  return ownRequests.some((r) => isActivePending(r, nowMs) && intervalsOverlap(r, candidate))
}

/** Pending requests to the same host that must be auto-declined when `accepted` is accepted. */
export function autoDeclineIds(accepted: RequestLike, hostPending: RequestLike[]): string[] {
  return hostPending
    .filter((r) => r.id !== accepted.id && r.status === "pending" && intervalsOverlap(r, accepted))
    .map((r) => r.id)
}

/** Groups requests into clusters of transitively overlapping time ranges, ordered by start. */
export function groupOverlapping<T extends RequestLike>(requests: T[]): T[][] {
  const sorted = [...requests].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const groups: T[][] = []
  let groupEnd = -Infinity
  for (const r of sorted) {
    if (groups.length > 0 && r.startMs < groupEnd) {
      groups[groups.length - 1].push(r)
      groupEnd = Math.max(groupEnd, r.endMs)
    } else {
      groups.push([r])
      groupEnd = r.endMs
    }
  }
  return groups
}
