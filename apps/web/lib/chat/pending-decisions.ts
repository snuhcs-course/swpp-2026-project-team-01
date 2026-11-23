import type { HostRequestItem } from "@lib/contracts/host-request";

// The number of received requests waiting on the host's decision, shown as a
// badge on the workspace menu and its Requests item (#295). A sample request
// never counts: the service reports it as needing no decision.

/** Fired after a request changes in this tab, so the menu badge reloads. */
export const REQUESTS_CHANGED_EVENT = "fmat:requests-changed";

export function pendingDecisionCount(items: readonly Pick<HostRequestItem, "needsDecision">[]) {
  return items.filter((item) => item.needsDecision).length;
}

/** The badge's text: the count, capped at "9+" to keep the badge round. */
export function badgeText(count: number) {
  return count > 9 ? "9+" : String(count);
}

/** The words a screen reader hears for the count. */
export function pendingDecisionLabel(count: number) {
  return count === 1 ? "1 request needs your decision" : `${count} requests need your decision`;
}

export function announceRequestsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REQUESTS_CHANGED_EVENT));
}
