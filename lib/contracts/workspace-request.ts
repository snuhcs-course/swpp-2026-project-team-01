import type { RequestState } from "./request";

// The signed-in account's Requests list. A sent request is linked only after
// the guest's verified Google subject or signed-in account session matched it.
export type WorkspaceRequestItem = {
  readonly requestId: string;
  readonly sample: boolean;
  readonly direction: "received" | "sent";
  readonly counterpartyName: string;
  readonly purpose: string | null;
  readonly state: RequestState;
  readonly proposalStart: string | null;
  readonly needsDecision: boolean;
  readonly updatedAt: string;
  // Only a matched sent request with a still-live private link has this path.
  readonly bookingPath: string | null;
  // A sent request still open for conversation; a received one is always false.
  // An inactive sent request shows its conversation read-only in the list.
  readonly active: boolean;
};
