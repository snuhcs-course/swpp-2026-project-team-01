import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HostWordmark } from "./host-wordmark";
import { Brand } from "./ink/chrome";

describe("the wordmark on signed-in host pages (#366)", () => {
  it("is the page heading and links to the workspace at /app", () => {
    const html = renderToStaticMarkup(<HostWordmark className="min-w-0" />);
    expect(html).toMatch(/^<h1 class="min-w-0"><a class="wordmark-lockup" href="\/app">Find Me a Time<\/a><\/h1>$/);
  });

  it("leaves the public logo on the landing and sends the link step's to /app", () => {
    expect(renderToStaticMarkup(<Brand />)).toContain('href="/"');
    expect(renderToStaticMarkup(<Brand href="/app" />)).toContain('href="/app"');
  });
});
