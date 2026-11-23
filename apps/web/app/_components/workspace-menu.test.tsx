import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PendingBadge } from "./workspace-menu";

describe("pending decision badge", () => {
  it("shows nothing when no request needs a decision", () => {
    expect(renderToStaticMarkup(<PendingBadge count={0} />)).toBe("");
  });

  it("shows the count, capped at 9+, hidden from screen readers that hear the label instead", () => {
    const one = renderToStaticMarkup(<PendingBadge count={1} />);
    expect(one).toContain(">1</span>");
    expect(one).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<PendingBadge count={14} />)).toContain(">9+</span>");
  });
});
