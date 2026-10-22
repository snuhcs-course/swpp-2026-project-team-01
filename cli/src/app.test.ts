import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT, main, parseArgs, UsageError } from "./app.js";
import { chooseStore, readSaved, saveConnection, StoreError } from "./store.js";

function io(env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    err,
    io: { env, readLine: async () => "", stderr: (text: string) => void err.push(text), stdout: (text: string) => void out.push(text) },
    json: () => out.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("arguments", () => {
  it("parse flags with and without inline values", () => {
    expect(parseArgs(["call", "get_request", "--input", '{"a":1}', "--retry-key=k-1", "--host"])).toEqual({
      command: "call",
      flags: { host: true, input: '{"a":1}', "retry-key": "k-1" },
      positional: ["get_request"],
    });
  });

  it("refuse unknown, repeated and valueless flags", () => {
    expect(() => parseArgs(["login", "--hots"])).toThrow(UsageError);
    expect(() => parseArgs(["login", "--host", "--host"])).toThrow(UsageError);
    expect(() => parseArgs(["login", "--handle"])).toThrow(UsageError);
    expect(() => parseArgs(["login", "--handle", "--host"])).toThrow(UsageError);
    expect(() => parseArgs(["login", "--host=yes"])).toThrow(UsageError);
  });
});

describe("output and exit codes", () => {
  it("prints one JSON object with a usage error and exit code 2", async () => {
    const run = io({ FMAT_CREDENTIAL_STORE: "file", FMAT_CONFIG_DIR: mkdtempSync(join(tmpdir(), "fmat-")) });
    expect(await main(["login"], run.io)).toBe(EXIT.usage);
    expect(run.json()).toEqual([{ error: expect.objectContaining({ category: "usage" }), ok: false }]);

    const both = io({ FMAT_CREDENTIAL_STORE: "file", FMAT_CONFIG_DIR: mkdtempSync(join(tmpdir(), "fmat-")) });
    expect(await main(["login", "--host", "--handle", "dodo"], both.io)).toBe(EXIT.usage);
  });

  it("asks for a login before calling the service", async () => {
    const run = io({ FMAT_CREDENTIAL_STORE: "file", FMAT_CONFIG_DIR: mkdtempSync(join(tmpdir(), "fmat-")) });
    expect(await main(["call", "get_request", "--handle", "dodo"], run.io)).toBe(EXIT.authorization);
    expect(run.json()[0]).toMatchObject({ error: { category: "not_connected", nextAction: "Run fmat login --handle dodo again." }, ok: false });
  });

  it("refuses a plain http origin that is not this machine", async () => {
    const run = io({ FMAT_CREDENTIAL_STORE: "file", FMAT_CONFIG_DIR: mkdtempSync(join(tmpdir(), "fmat-")), FMAT_ORIGIN: "http://findmeatime.example" });
    expect(await main(["status"], run.io)).toBe(EXIT.usage);
  });

  it("never prints a token in status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fmat-"));
    const env = { FMAT_CONFIG_DIR: dir, FMAT_CREDENTIAL_STORE: "file" };
    process.env.FMAT_CONFIG_DIR = dir;
    saveConnection("file", {
      accessExpiresAt: Date.now() + 60_000,
      accessToken: "secret-access",
      clientId: "fmat-cli",
      handle: null,
      origin: "https://findmeatime.com",
      refreshToken: "secret-refresh",
      resource: "https://findmeatime.com/mcp",
      role: "host",
      scope: "host:read",
    });
    expect(readSaved("file").current).toBe("https://findmeatime.com/mcp");
    const run = io(env);
    expect(await main(["status"], run.io)).toBe(EXIT.ok);
    const printed = JSON.stringify(run.json());
    expect(printed).toContain("host:read");
    expect(printed).not.toContain("secret-");
    delete process.env.FMAT_CONFIG_DIR;
  });
});

describe("credential store", () => {
  it("uses the system store by platform and a file only when asked", () => {
    expect(chooseStore(undefined, "darwin")).toBe("keychain");
    expect(chooseStore("file", "win32")).toBe("file");
    expect(() => chooseStore(undefined, "win32")).toThrow(StoreError);
    expect(() => chooseStore("vault")).toThrow(StoreError);
  });
});
