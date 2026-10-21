import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResendLinkForm } from "./resend-link-form";

describe("ResendLinkForm", () => {
  it("labels its address field and names its one action", () => {
    const html = renderToStaticMarkup(<ResendLinkForm />);
    const inputId = html.match(/<input[^>]*id="([^"]+)"/)?.[1];

    expect(inputId).toBeTruthy();
    expect(html).toContain(`for="${inputId}"`);
    expect(html).toContain('type="email"');
    expect(html).toContain("Resend my booking link");
    expect(html).toContain('role="status"');
  });

  it("offers no credential field or other recovery control", () => {
    const html = renderToStaticMarkup(<ResendLinkForm />);

    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});
