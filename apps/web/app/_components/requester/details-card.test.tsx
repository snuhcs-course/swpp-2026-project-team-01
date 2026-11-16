import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RequesterCardContext } from "./cards";
import { DetailsCard } from "./request-cards";

const noop = () => {};

function context(details: Record<string, unknown>): RequesterCardContext {
  return {
    bookingId: "booking",
    chooseAnotherTime: noop,
    closeDetails: noop,
    focusCard: noop,
    onAgreed: noop,
    onAgreementFailure: noop,
    openDetails: noop,
    refresh: async () => {},
    run: async () => ({ ok: true }) as never,
    timezone: "Asia/Seoul",
    view: { request: { details, revision: 1 } } as unknown as RequesterCardContext["view"],
  };
}

describe("DetailsCard", () => {
  it("asks for the place of an in-person meeting but never how the guest will travel", () => {
    const html = renderToStaticMarkup(
      <DetailsCard context={context({ location: "Cafe Onion, Seongsu", mode: "in_person", travelMode: "driving" })} />,
    );

    expect(html).toContain("Place");
    expect(html).toContain("Cafe Onion, Seongsu");
    expect(html).not.toContain("How you will travel");
    expect(html).not.toContain("Public transit");
  });
});
