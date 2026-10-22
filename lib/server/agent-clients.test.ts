import { describe, expect, it } from "vitest";
import {
  ClientResolutionError,
  isMetadataDocumentUrl,
  isPublicAddress,
  isValidRedirectUri,
  matchesRedirectUri,
  parseMetadataDocument,
} from "./agent-clients";

describe("redirect URIs", () => {
  it("allow https and loopback http only, without fragments or credentials", () => {
    expect(isValidRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(isValidRedirectUri("http://127.0.0.1:33418/callback")).toBe(true);
    expect(isValidRedirectUri("http://localhost:6274/oauth/callback")).toBe(true);
    expect(isValidRedirectUri("http://[::1]/callback")).toBe(true);
    expect(isValidRedirectUri("http://agent.example/callback")).toBe(false);
    expect(isValidRedirectUri("https://agent.example/callback#x")).toBe(false);
    expect(isValidRedirectUri("https://user:pass@agent.example/callback")).toBe(false);
    expect(isValidRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(false);
  });

  it("match exactly, except a loopback IP literal's port", () => {
    const registered = ["https://agent.example/cb?x=1", "http://127.0.0.1/callback", "http://localhost:3000/cb"];
    expect(matchesRedirectUri(registered, "https://agent.example/cb?x=1")).toBe(true);
    expect(matchesRedirectUri(registered, "https://agent.example/cb")).toBe(false);
    expect(matchesRedirectUri(registered, "https://agent.example/cb?x=2")).toBe(false);
    expect(matchesRedirectUri(registered, "http://127.0.0.1:49152/callback")).toBe(true);
    expect(matchesRedirectUri(registered, "http://127.0.0.1:49152/other")).toBe(false);
    expect(matchesRedirectUri(registered, "http://[::1]:49152/callback")).toBe(false);
    // localhost is a name, not an IP literal: its port must match.
    expect(matchesRedirectUri(registered, "http://localhost:3001/cb")).toBe(false);
    expect(matchesRedirectUri(registered, "http://localhost:3000/cb")).toBe(true);
  });
});

describe("client ID metadata documents", () => {
  it("name an https URL with a path on a named host", () => {
    expect(isMetadataDocumentUrl("https://claude.ai/oauth/mcp-oauth-client-metadata")).toBe(true);
    expect(isMetadataDocumentUrl("https://claude.ai/")).toBe(false);
    expect(isMetadataDocumentUrl("http://claude.ai/client.json")).toBe(false);
    expect(isMetadataDocumentUrl("https://10.0.0.1/client.json")).toBe(false);
    expect(isMetadataDocumentUrl("https://[::1]/client.json")).toBe(false);
    expect(isMetadataDocumentUrl("https://localhost/client.json")).toBe(false);
    expect(isMetadataDocumentUrl("https://intranet/client.json")).toBe(false);
    expect(isMetadataDocumentUrl("https://agent.example:8443/client.json")).toBe(false);
  });

  it("are fetched only from public addresses", () => {
    for (const address of ["8.8.8.8", "2606:4700:4700::1111", "1.1.1.1"]) expect(isPublicAddress(address)).toBe(true);
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "not-an-ip"]) {
      expect(isPublicAddress(address)).toBe(false);
    }
  });

  it("must name themselves and list allowed redirects", () => {
    const id = "https://agent.example/client.json";
    expect(parseMetadataDocument(id, JSON.stringify({ client_id: id, client_name: "Agent", redirect_uris: ["https://agent.example/cb"] }))).toMatchObject({
      name: "Agent",
      redirectUris: ["https://agent.example/cb"],
    });
    expect(() => parseMetadataDocument(id, JSON.stringify({ client_id: `${id}x`, client_name: "Agent", redirect_uris: ["https://agent.example/cb"] }))).toThrow(
      ClientResolutionError,
    );
    expect(() => parseMetadataDocument(id, JSON.stringify({ client_id: id, client_name: "Agent", redirect_uris: [] }))).toThrow(ClientResolutionError);
    expect(() => parseMetadataDocument(id, JSON.stringify({ client_id: id, client_name: "Agent", redirect_uris: ["http://agent.example/cb"] }))).toThrow(
      ClientResolutionError,
    );
    expect(() => parseMetadataDocument(id, "<html>")).toThrow(ClientResolutionError);
  });
});
