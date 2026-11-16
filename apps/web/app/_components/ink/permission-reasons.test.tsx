import { PERMISSION_REASONS } from "@lib/contracts/permission-reasons";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NOTE_REVIEW_COPY } from "../notes/note-review-copy";
import { GoogleStart } from "./landing-parts";

const escaped = (text: string) => text.replaceAll("'", "&#x27;");

// Issue #203: the web shows the same reason lines the linked chats send.
describe("permission reasons on the web", () => {
  it("puts the Google reason under the Google button", () => {
    const html = renderToStaticMarkup(<GoogleStart locale="en" />);
    expect(html).toContain('href="/auth/sign-in"');
    expect(html).toContain(escaped(PERMISSION_REASONS.en.googleSignIn));
  });

  it("gives the note review page the note reason", () => {
    expect(NOTE_REVIEW_COPY.en.why).toBe(PERMISSION_REASONS.en.noteReview);
    expect(NOTE_REVIEW_COPY.ko.why).toBe(PERMISSION_REASONS.ko.noteReview);
  });
});
