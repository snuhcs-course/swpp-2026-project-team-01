import { defineState } from "eve/context";

// Per-turn navigation only: IDs, never a copied request, calendar or memory.
// The provider re-authorizes and reloads these requests after compaction.
type ReadNavigation = { turnId: string | null; requestIds: string[] };
export const accountTurnReads = defineState<ReadNavigation>("fmat.account-turn-reads", () => ({ turnId: null, requestIds: [] }));
export function recordAccountRead(turnId: string, requestId: string) {
  accountTurnReads.update(current => ({ turnId, requestIds: [...new Set([...(current.turnId === turnId ? current.requestIds : []), requestId])].slice(-20) }));
}
export function accountReadIds(turnId: string | null) {
  const current = accountTurnReads.get();
  if (turnId !== null && current.turnId === turnId) return current.requestIds;
  accountTurnReads.update(() => ({ turnId, requestIds: [] }));
  return [];
}
