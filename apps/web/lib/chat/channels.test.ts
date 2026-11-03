import type { EveMessage } from "eve/react";
import { describe, expect, it } from "vitest";
import { messagingChannels, messagingLabel, splitByChannel } from "./channels";

// A forwarded message and the reply to it go to the messaging tab without the
// marker; everything else stays on the web tab (host-imessage-channel D20).

let next = 0;
const text = (role: "user" | "assistant", value: string) =>
  ({ id: `m${(next += 1)}`, parts: [{ state: "done", text: value, type: "text" }], role }) as EveMessage;

describe("splitByChannel", () => {
  it("gives each reply the channel of the host message it answers", () => {
    const entries = splitByChannel([
      text("user", "Hi from the web"),
      text("assistant", "Hello"),
      text("user", "[iMessage] 30 minutes"),
      text("assistant", "Got it: 30 minutes."),
      text("user", "Back on the web"),
      text("assistant", "Welcome back"),
    ]);

    expect(entries.map((entry) => entry.channel)).toEqual(["web", "web", "imessage", "imessage", "web", "web"]);
    expect(entries.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(entries[2]!.message.parts[0]).toMatchObject({ text: "30 minutes" });
    expect(entries[3]!.message.parts[0]).toMatchObject({ text: "Got it: 30 minutes." });
  });

  it("keeps an assistant message before any host message on the web tab", () => {
    expect(splitByChannel([text("assistant", "Welcome")]).map((entry) => entry.channel)).toEqual(["web"]);
  });

  it("reads only a marker at the start of the message", () => {
    const [entry] = splitByChannel([text("user", "I said [iMessage] earlier")]);
    expect(entry!.channel).toBe("web");
    expect(entry!.message.parts[0]).toMatchObject({ text: "I said [iMessage] earlier" });
  });

  it("names every messaging channel the discussion used", () => {
    const entries = splitByChannel([text("user", "[WhatsApp] hi"), text("user", "[iMessage] hello")]);
    expect(messagingChannels(entries)).toEqual(["whatsapp", "imessage"]);
    expect(messagingLabel(messagingChannels(entries))).toBe("WhatsApp & iMessage");
    expect(messagingChannels(splitByChannel([text("user", "web only")]))).toEqual([]);
  });
});
