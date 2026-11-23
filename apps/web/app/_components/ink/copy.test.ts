import { expect, test } from "vitest";
import { channelCopy, COPY } from "./copy";

// The number screen names the channel it registers for (guest-whatsapp-link D3).
test("the number screen names WhatsApp for a WhatsApp code and keeps the field's words", () => {
  for (const locale of ["en"] as const) {
    const whatsapp = channelCopy(COPY[locale], "whatsapp").number;
    expect(whatsapp.heading).toBe(COPY[locale].wa.number.heading);
    expect(whatsapp.fine).toBe(COPY[locale].wa.number.fine);
    expect(whatsapp.label).toBe(COPY[locale].number.label);
    expect(channelCopy(COPY[locale], "imessage").number).toBe(COPY[locale].number);
    expect(channelCopy(COPY[locale], "telegram").number).toBe(COPY[locale].number);
  }
  expect(channelCopy(COPY.en, "whatsapp").number.heading).toBe("Which number do you use for WhatsApp?");
});

// Back from Thyme's Calendar link, /app says Calendar is connected and setup continues in the linked app (#360).
test("the Calendar return names Google Calendar and the linked app", () => {
  for (const [channel, name] of [["imessage", "iMessage"], ["whatsapp", "WhatsApp"], ["telegram", "Telegram"]] as const) {
    const link = channelCopy(COPY.en, channel).link;
    expect(link.calendarConnected).toBe("Google Calendar is connected.");
    expect(link.calendarConnectedLede).toBe(`Setup continues in ${name}. Thyme just sent you the next step there.`);
    expect(link.calendarConnected).not.toBe(link.connected);
  }
});
