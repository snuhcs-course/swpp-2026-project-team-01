import { describe, expect, it } from "vitest";
import { GOOGLE_AUTH_URL, requesterGoogleConfigFromEnvironment } from "./requester-google";

describe("requesterGoogleConfigFromEnvironment", () => {
  const host = { GOOGLE_CLIENT_ID: "host-client", GOOGLE_CLIENT_SECRET: "host-secret" };

  it("uses the requester OAuth client when it is set", () => {
    expect(
      requesterGoogleConfigFromEnvironment({
        ...host,
        GOOGLE_REQUESTER_CLIENT_ID: "requester-client",
        GOOGLE_REQUESTER_CLIENT_SECRET: "requester-secret",
      }),
    ).toMatchObject({ authUrl: GOOGLE_AUTH_URL, clientId: "requester-client", clientSecret: "requester-secret" });
  });

  it("falls back to the host sign-in client when the requester client is unset", () => {
    for (const requester of [{}, { GOOGLE_REQUESTER_CLIENT_ID: "", GOOGLE_REQUESTER_CLIENT_SECRET: " " }]) {
      expect(requesterGoogleConfigFromEnvironment({ ...host, ...requester })).toMatchObject({
        clientId: "host-client",
        clientSecret: "host-secret",
      });
    }
    expect(requesterGoogleConfigFromEnvironment({})).toMatchObject({ clientId: "", clientSecret: "" });
  });
});
