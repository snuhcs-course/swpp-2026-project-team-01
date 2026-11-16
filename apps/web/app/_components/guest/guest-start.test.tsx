import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuestStart } from "./guest-start";

// The booking-link landing for a signed-in account (host-as-guest-session).
const host = { displayName: "Barbara Liskov", handle: "barbara" };

describe("GuestStart landing", () => {
  it("tells an anonymous guest no account is needed", () => {
    const html = renderToStaticMarkup(<GuestStart host={host} />);

    expect(html).toContain("You need no account.");
    expect(html).toContain("Continue with web");
    expect(html).not.toContain("Continue your request");
    expect(html).not.toContain('href="/app"');
  });

  it("recognizes a signed-in account and offers its open request first", () => {
    const html = renderToStaticMarkup(
      <GuestStart host={host} visitor={{ name: "Ada Lovelace", openRequestPath: "/booking/1234", ownLink: false }} />,
    );

    expect(html).toContain("You&#x27;re signed in as Ada Lovelace");
    expect(html.indexOf('href="/booking/1234"')).toBeGreaterThan(-1);
    expect(html.indexOf("Continue your request")).toBeLessThan(html.indexOf("Start a new request"));
    expect(html).not.toContain("You need no account.");
  });

  it("keeps the usual start for a signed-in account without an open request", () => {
    const html = renderToStaticMarkup(<GuestStart host={host} visitor={{ name: "Ada Lovelace", openRequestPath: null, ownLink: false }} />);

    expect(html).toContain("Continue with web");
    expect(html).not.toContain("Continue your request");
  });

  it("tells a host their own link is theirs, with the way back to /app", () => {
    const html = renderToStaticMarkup(<GuestStart host={host} visitor={{ name: "Barbara Liskov", openRequestPath: null, ownLink: true }} />);

    expect(html).toContain("This is your own booking link");
    expect(html).toContain('href="/app"');
    expect(html).not.toContain("You&#x27;re signed in as");
  });
});
