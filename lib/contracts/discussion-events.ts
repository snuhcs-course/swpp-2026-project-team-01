import type { MessageStreamEvent } from "eve/client";

// The events of a host's discussion as the web service serves them: eve's own
// stream events, except that an input recovery sent again to a successor keeps
// the message the host already saw, and its repeated message.received is served
// as this marker instead. The marker still counts toward the discussion cursor,
// so cursors stay aligned with the runtime's stream; the browser does not show it.
export type RedeliveredInputEvent = {
  readonly type: "app.input.redelivered";
  readonly data: Record<string, never>;
  readonly meta: MessageStreamEvent["meta"];
};

export type DiscussionEvent = MessageStreamEvent | RedeliveredInputEvent;

export function isRedeliveredInput(event: DiscussionEvent): event is RedeliveredInputEvent {
  return event.type === "app.input.redelivered";
}
