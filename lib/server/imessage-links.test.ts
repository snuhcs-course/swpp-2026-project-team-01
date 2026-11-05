import { describe, expect, it, vi } from "vitest";
import { attemptLineNumber } from "./imessage-links";
import type { PhotonRegistrar, PhotonRegistration } from "./photon";

// The number a link attempt keeps (imessage-number-registration design 2,
// guest-whatsapp-link design 4): iMessage and WhatsApp register the entered
// number first, only iMessage keeps Photon's assigned number, and Telegram
// registers nothing.

function registrar(answer: PhotonRegistration) {
  const send = vi.fn(async () => answer);
  return { registrar: { endpoint: "http://127.0.0.1:4100", send } as PhotonRegistrar, send };
}

describe("attemptLineNumber", () => {
  it("keeps the assigned number for iMessage", async () => {
    const { registrar: r, send } = registrar({ lineNumber: "+15550009999", status: "registered" });
    await expect(attemptLineNumber(r, "imessage", "+1 555 123 4567")).resolves.toBe("+15550009999");
    expect(send).toHaveBeenCalledWith("+15551234567");
  });

  it("registers a WhatsApp number but keeps no assigned number", async () => {
    const { registrar: r, send } = registrar({ lineNumber: "+15550009999", status: "registered" });
    await expect(attemptLineNumber(r, "whatsapp", "+15551234567")).resolves.toBeNull();
    expect(send).toHaveBeenCalledWith("+15551234567");
  });

  it("refuses a missing or malformed WhatsApp number before registering", async () => {
    const { registrar: r, send } = registrar({ lineNumber: "+15550009999", status: "registered" });
    await expect(attemptLineNumber(r, "whatsapp", "")).rejects.toMatchObject({ category: "invalid_input" });
    await expect(attemptLineNumber(r, "whatsapp", "not a number")).rejects.toMatchObject({ category: "invalid_input" });
    expect(send).not.toHaveBeenCalled();
  });

  it("treats a refused or lost WhatsApp registration as unavailable", async () => {
    await expect(attemptLineNumber(registrar({ status: "refused" }).registrar, "whatsapp", "+15551234567")).rejects.toMatchObject({
      category: "unavailable_configuration",
    });
    await expect(attemptLineNumber(registrar({ status: "unavailable" }).registrar, "whatsapp", "+15551234567")).rejects.toMatchObject({
      category: "unavailable_configuration",
    });
  });

  it("registers nothing for Telegram", async () => {
    const { registrar: r, send } = registrar({ lineNumber: "+15550009999", status: "registered" });
    await expect(attemptLineNumber(r, "telegram", "")).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
