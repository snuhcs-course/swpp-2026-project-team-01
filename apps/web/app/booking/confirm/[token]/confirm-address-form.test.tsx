import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmAddressForm } from "./confirm-address-form";

describe("ConfirmAddressForm", () => {
  it("asks for a button press instead of confirming on load", () => {
    const html = renderToStaticMarkup(<ConfirmAddressForm token="a-confirmation-token" />);

    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('type="submit"');
    expect(html).toContain("Confirm this address");
    expect(html).not.toContain("Address confirmed");
    expect(html).not.toContain("a-confirmation-token");
  });
});
