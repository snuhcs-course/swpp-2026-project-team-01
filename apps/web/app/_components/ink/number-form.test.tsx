import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { channelCopy, COPY } from "./copy";
import { NumberForm } from "./number-form";

// The SMS consent beside the number (#488): Photon's 10DLC review rejects a form whose consent checkbox is
// missing, ticked from the start, required, or bundled with other consent (codes 803 and 806).

const CONSENT =
  "By checking this box, you agree to receive meeting notifications and assistant replies by text from Find Me a Time. Message frequency may vary. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. We will not share mobile information with third parties for promotional or marketing purposes.";

function render(look: "ink" | "card", channel: "imessage" | "whatsapp" = "imessage") {
  return renderToStaticMarkup(<NumberForm id="test-number" look={look} onSubmit={async () => null} t={channelCopy(COPY.en, channel).number} />);
}

describe("NumberForm SMS consent", () => {
  for (const look of ["ink", "card"] as const) {
    it(`shows one unticked, optional SMS checkbox with the campaign's text and policy links (${look})`, () => {
      const markup = render(look);
      const boxes = markup.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
      expect(boxes).toHaveLength(1);
      expect(boxes[0]).not.toMatch(/\schecked/);
      expect(boxes[0]).not.toMatch(/\srequired/);
      // The number field is not required either; the form validates the number itself.
      expect(markup).not.toMatch(/\srequired/);
      // The checkbox's own label holds the consent and nothing else.
      const id = boxes[0]!.match(/id="([^"]+)"/)![1];
      const label = markup.match(new RegExp(`<label[^>]*for="${id}"[^>]*>([\\s\\S]*?)</label>`))![1]!;
      expect(label.replace(/<[^>]+>/g, "")).toBe(`${CONSENT} Privacy Policy and Terms.`);
      expect(label).toMatch(/href="\/privacy-policy"/);
      expect(label).toMatch(/href="\/terms-of-service"/);
    });
  }

  it("keeps the consent on the WhatsApp number too", () => {
    expect(render("ink", "whatsapp")).toContain(CONSENT);
  });

  it("keeps the campaign's consent text word for word", () => {
    expect(COPY.en.number.smsConsent).toBe(CONSENT);
  });
});
