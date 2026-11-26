import { describe, expect, it } from "vitest";
import { decodeIntegerArray } from "./bplist.ts";
import { codeHash, linkCodes, sign, signedHeaders } from "./signer.ts";
import { RECORDED } from "./testing.ts";

// The Mac relay's signer against PROTOCOL.md's known-answer vectors, which the
// phone app and the service assert too, and the display-member decoder against
// the property lists recorded on the Mac mini.

describe("signer", () => {
  it("matches vector 1 (webhook)", () => {
    const body =
      '{"eventId":"486083133936417:1795662000123:0","roomId":"486083133936417","isGroup":false,"senderName":"Test Host","text":"hello","postedAt":"2026-11-26T03:00:00.123Z"}';
    expect(sign("test-inbound-secret", "POST", "/kakaotalk/webhook", "1795662000", "00112233445566778899aabbccddeeff", body)).toBe(
      "83ea0d183792ab410a9b1795d8837af1c85087b3c04263f43d8358b7117a90e9",
    );
  });

  it("matches vector 2 (claim)", () => {
    expect(
      sign("test-outbox-secret", "POST", "/kakaotalk/outbox/claim", "1795662000", "ffeeddccbbaa99887766554433221100", '{"postedRooms":["486083133936417"],"locked":false}'),
    ).toBe("c7760506fd48489399251e46543b56529c93fc1a425b560bc9d46ac7e205e7a5");
  });

  it("matches vector 3 (void_code hash) and finds codes as the service does", () => {
    expect(linkCodes("코드 fmat-7k3q9m2xwa 입니다")).toEqual(["FMAT-7K3Q9M2XWA"]);
    expect(codeHash("test-inbound-secret", "fmat-7k3q9m2xwa")).toBe("2a6f0e5c45fef716cd8c61d3ebfce454cb918bd2a0fccf178aa204356fa23fa2");
    expect(linkCodes("xFMAT-7K3Q9M2XWA FMAT-7K3Q9M2XW FMAT-7K3Q9M2XWA FMAT-AAAAAAAAAA")).toEqual(["FMAT-7K3Q9M2XWA", "FMAT-AAAAAAAAAA"]);
    expect(linkCodes("FMAT-ILOUILOUIL")).toEqual([]);
  });

  it("puts the timestamp in seconds and a fresh 32-character nonce in the headers", () => {
    const headers = signedHeaders("s", "/kakaotalk/heartbeat", "{}", 1795662000999);
    expect(headers["X-FMAT-Relay-Timestamp"]).toBe("1795662000");
    expect(headers["X-FMAT-Relay-Nonce"]).toMatch(/^[0-9a-f]{32}$/);
    expect(headers["X-FMAT-Relay-Signature"]).toBe(sign("s", "POST", "/kakaotalk/heartbeat", "1795662000", headers["X-FMAT-Relay-Nonce"]!, "{}"));
  });
});

describe("display member IDs", () => {
  const [direct, group, account] = RECORDED.rooms();

  it("decodes the recorded one-member and four-member lists", () => {
    expect(decodeIntegerArray(direct![8] as string)).toEqual([RECORDED.host]);
    expect(decodeIntegerArray(group![8] as string)).toEqual(["900000003", "900000004", RECORDED.host, "900000005"]);
    expect(decodeIntegerArray(account![8] as string)).toEqual(["900000006"]);
  });

  it("refuses anything that is not a bplist array of integers", () => {
    expect(decodeIntegerArray("")).toEqual([]);
    expect(decodeIntegerArray("zz")).toBeNull();
    expect(decodeIntegerArray("62706C6973743030")).toBeNull();
    // The recorded list with its array marker turned into a string marker.
    expect(decodeIntegerArray((direct![8] as string).replace("A101", "5101"))).toBeNull();
    // Truncated.
    expect(decodeIntegerArray((group![8] as string).slice(0, 60))).toBeNull();
  });
});
