// What the browser's conversation clients share: a conversation's status and the
// error a route answers with. The host has no chat on the web; they talk to
// Thyme in their linked messenger (remove-host-web-chat). The guest's booking
// conversation (guest.ts) and the host's request routes (host-requests.ts) use
// these.

export type DiscussionStatus = {
  readonly generation: number | null;
  readonly state: "none" | "active" | "failed";
  readonly pendingInputs: number;
};

export class ChatRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ChatRequestError";
    this.code = code;
    this.status = status;
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof ChatRequestError) return error.message;
  return "Something went wrong. Try again.";
}
