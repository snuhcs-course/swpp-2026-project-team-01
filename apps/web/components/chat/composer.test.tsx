import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatComposer } from "./composer";

// The chat input while Thyme answers (#119): the host or guest may type the
// next message, while sending waits for the turn to end; a closed or preparing
// conversation still locks the input.
function render(props: { readonly isBusy?: boolean; readonly isPreparing?: boolean; readonly disabled?: boolean }) {
  return renderToStaticMarkup(
    <ChatComposer autoFocus={false} onChange={() => undefined} onStop={() => undefined} onSubmit={() => undefined} value="Next question" {...props} />,
  );
}

function textarea(html: string) {
  return html.match(/<textarea[^>]*>/)?.[0] ?? "";
}

describe("ChatComposer while Thyme answers", () => {
  it("keeps the input open for typing, with no send button", () => {
    const html = render({ isBusy: true });
    expect(textarea(html)).not.toMatch(/\sdisabled=/);
    expect(html).toContain('aria-label="Response in progress"');
    expect(html).not.toContain('aria-label="Send message"');
  });

  it("still locks the input while preparing or closed", () => {
    expect(textarea(render({ isPreparing: true }))).toMatch(/\sdisabled=/);
    expect(textarea(render({ disabled: true }))).toMatch(/\sdisabled=/);
  });
});
