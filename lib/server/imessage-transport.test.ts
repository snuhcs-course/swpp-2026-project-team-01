import { describe, expect, it } from "vitest";
import { ImessageSendError, imessageTransportFromEnvironment, standInTransport } from "./imessage-transport";

describe("the iMessage stand-in transport", () => {
  const reply = (status: number, body: unknown) => async () => Response.json(body, { status });
  const message = { text: "hi", to: "+821012345678" };

  it("returns the receipt", async () => {
    const transport = standInTransport("http://stand-in", reply(200, { line: "+15550100", messageId: "m", spaceId: "s" }));
    await expect(transport.send(message)).resolves.toEqual({ line: "+15550100", messageId: "m", spaceId: "s" });
  });

  it("reports a named failure, an unknown refusal and a lost response", async () => {
    const failure = async (fetcher: typeof fetch) => {
      try {
        await standInTransport("http://stand-in", fetcher).send(message);
      } catch (error) {
        return error instanceof ImessageSendError ? error.failure : "other";
      }
      return "none";
    };

    expect(await failure(reply(422, { failure: "non_imessage_recipient" }))).toBe("non_imessage_recipient");
    expect(await failure(reply(400, {}))).toBe("provider_rejected");
    expect(await failure(reply(503, {}))).toBe("uncertain");
    expect(await failure(async () => { throw new TypeError("reset"); })).toBe("uncertain");
  });
});

describe("transport configuration", () => {
  it("is unavailable until a transport is configured", () => {
    expect(imessageTransportFromEnvironment({})).toBeNull();
    expect(imessageTransportFromEnvironment({ IMESSAGE_TRANSPORT: "photon" })).toBeNull();
    expect(imessageTransportFromEnvironment({ IMESSAGE_STANDIN_URL: "http://x", IMESSAGE_TRANSPORT: "standin" })).not.toBeNull();
  });
});
