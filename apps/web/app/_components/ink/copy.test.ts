import { expect, test } from "vitest";
import { channelCopy, COPY } from "./copy";

// The number screen names the channel it registers for (guest-whatsapp-link D3).
test("the number screen names WhatsApp for a WhatsApp code and keeps the field's words", () => {
  for (const locale of ["en", "ko"] as const) {
    const whatsapp = channelCopy(COPY[locale], "whatsapp").number;
    expect(whatsapp.heading).toBe(COPY[locale].wa.number.heading);
    expect(whatsapp.fine).toBe(COPY[locale].wa.number.fine);
    expect(whatsapp.label).toBe(COPY[locale].number.label);
    expect(channelCopy(COPY[locale], "imessage").number).toBe(COPY[locale].number);
    expect(channelCopy(COPY[locale], "telegram").number).toBe(COPY[locale].number);
  }
  expect(channelCopy(COPY.en, "whatsapp").number.heading).toBe("Which number do you use for WhatsApp?");
});
