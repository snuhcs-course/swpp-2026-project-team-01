import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HOST_TOOLS } from "./agent-host-tools";
import { REQUESTER_TOOLS } from "./agent-requester-tools";
import { inputSchema } from "./agent-tools";
import { chatStatus, openConnectLink, sealConnectLink } from "./connect-link";
import { hostEntryDocument, requesterEntryDocument } from "./entry-documents";
import { setupNextStep } from "./setup-tools";
import { parseTokenKey, sealToken } from "./token-encryption";

const key = parseTokenKey(randomBytes(32).toString("base64"));
const linkId = "7d5f4a8e-6b1c-4f7e-9a2d-3c8b1e0f5a6d";
const origin = "https://findmeatime.test";

describe("connect-link tokens", () => {
  it.each(["host", "requester"] as const)("opens only a sealed %s attempt", role => {
    const token = sealConnectLink(key, { role, linkId });
    expect(openConnectLink([key], token)).toEqual({ role, linkId });
    expect(openConnectLink([key], token.slice(0, -8) + "tampered")).toBeNull();
    expect(openConnectLink([parseTokenKey(randomBytes(32).toString("base64"))], token)).toBeNull();
    const wrong = sealToken(key, JSON.stringify({ role, linkId }), "other-context");
    expect(openConnectLink([key], `${wrong.keyId}.${wrong.ciphertext}`)).toBeNull();
    expect(openConnectLink([key], "bad")).toBeNull();
  });
});

describe("agent-led setup", () => {
  it.each(["update_setup_field", "confirm_setup"])("requires hostWords on %s", name => {
    const tool = HOST_TOOLS.find(tool => tool.name === name)!;
    const base = { expectedRevision: 0, retryKey: "setup-0001", ...(name === "confirm_setup" ? { proposalHash: "a".repeat(64) } : { input: { field: "durationMinutes", action: "choose_own", value: 45 } }) };
    expect(tool.input.safeParse({ ...base, hostWords: "  Yes, use that.  " }).success).toBe(true);
    for (const hostWords of [undefined, "   ", "x".repeat(501)]) expect(tool.input.safeParse({ ...base, hostWords }).success).toBe(false);
    expect(inputSchema(tool).required).toContain("hostWords");
    expect(tool.description).toContain("hostWords");
  });
  it.each([
    ["connect_calendar", `Ask the host to connect Google Calendar at ${origin}/app, then call get_setup again.`],
    ["choose_calendars", `Ask the host to choose their calendars at ${origin}/app, then call get_setup again.`],
    ["analyzing", "Their calendar is still being analyzed. Tell the host to wait a moment, then call get_setup again. Do not confirm yet."],
    ["review_suggestions", "Propose a value for each field in `missingFields`, from the suggestions or what you know about the host, and set it with update_setup_field only after the host agrees. Ask the host directly for meeting mode, place and travel mode when you do not know them."],
    ["confirm_settings", "Read the settings back to the host. When they agree, call confirm_setup with their words."],
    ["ready", "Setup is complete. Share the booking link with the host."],
  ] as const)("writes the %s step", (state, words) => expect(setupNextStep(state, origin)).toBe(words));
});

describe("link tools", () => {
  it("scopes link creation to the existing write permissions, with no confirm tool", () => {
    const host = HOST_TOOLS.find(tool => tool.name === "start_chat_link")!;
    const guest = REQUESTER_TOOLS.find(tool => tool.name === "start_updates_link")!;
    expect(host.scope).toBe("host:write");
    expect(guest.scope).toBe("request:write");
    for (const channel of ["imessage", "whatsapp", "telegram"]) {
      expect(host.input.safeParse({ channel, ...(channel === "telegram" ? {} : { number: "+821012345678" }), retryKey: "link-0001" }).success).toBe(true);
      expect(guest.input.safeParse({ channel, number: "+821012345678", retryKey: "link-0001" }).success).toBe(channel !== "telegram");
    }
    expect(host.input.safeParse({ channel: "imessage", retryKey: "link-0001" }).success).toBe(false);
    expect(host.input.safeParse({ channel: "telegram", number: "+821012345678", retryKey: "link-0001" }).success).toBe(false);
    expect([...HOST_TOOLS, ...REQUESTER_TOOLS].some(tool => /confirm.*link/.test(tool.name))).toBe(false);
  });
  it("returns only link state, channel and sender to agents", () => {
    expect(chatStatus({ state: "unavailable" })).toEqual({ channel: null, sender: null, state: "none" });
    expect(chatStatus({ state: "pending", channel: "imessage", code: "private", message: "private", lineNumber: "private", expiresAt: "soon" })).toEqual({ channel: "imessage", sender: null, state: "pending" });
  });
});

it("gives each role version 5 and client-specific connection steps", () => {
  for (const [document, name, endpoint] of [[hostEntryDocument(origin), "findmeatime", `${origin}/mcp`], [requesterEntryDocument(origin, { handle: "dodo", displayName: "Dodo" }), "findmeatime-dodo", `${origin}/dodo/mcp`]]) {
    expect(document).toContain("Instruction version: 5");
    expect(document).toContain(`claude mcp add --transport http ${name} ${endpoint}`);
    expect(document).toContain("`/mcp`");
    expect(document).toContain("restart Claude Code");
    for (const client of ["Claude", "ChatGPT", "Codex", "Dots", "Muse", "Instinct", "Other clients"]) expect(document).toContain(client);
    expect(document).toContain("Ask before adding a server. Never handle a token");
  }
});
