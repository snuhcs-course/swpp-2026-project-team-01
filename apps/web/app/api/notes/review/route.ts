import { createNoteReviewHandler } from "@lib/server/note-review";
import { connection } from "next/server";

const handle = createNoteReviewHandler();

// The signed-in host's note review: the latest scan's candidates with the
// classifier's recommendations, and their earlier decisions.
export async function GET(request: Request) {
  await connection();
  return handle(request);
}
