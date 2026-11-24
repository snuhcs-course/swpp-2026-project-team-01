import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkspaceLoading } from "./workspace-loading";

// The /app and /app/notes fallback is a quiet status, not the sign-in spread (#372).
it("announces loading without the sign-in layout", () => {
  const html = renderToStaticMarkup(<WorkspaceLoading />);
  expect(html).toBe('<div class="workspace-loading" role="status"><p>Loading your workspace…</p></div>');
  expect(html).not.toContain("Welcome to Thyme");
  expect(html).not.toContain("ld-");
});
