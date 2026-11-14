import { createNoteCommandHandler } from "@lib/server/note-review";

const handle = createNoteCommandHandler();

// Confirming the note review, and retrying a failed writeback.
export function POST(request: Request) {
  return handle(request);
}
