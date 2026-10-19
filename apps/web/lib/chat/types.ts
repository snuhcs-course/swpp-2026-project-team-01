import type { ClientSessionState, MessageStreamEvent } from "eve/client";

export type ActiveChat = {
  readonly events: readonly MessageStreamEvent[];
  readonly id: string;
  readonly pendingUserMessage: string | null;
  readonly session: ClientSessionState | undefined;
  readonly title: string;
};
