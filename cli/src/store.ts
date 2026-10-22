import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Where the CLI keeps its connections: the macOS Keychain, the Linux Secret
// Service (secret-tool), or, only when asked with --credential-store file or
// FMAT_CREDENTIAL_STORE=file, a file readable by the user alone. The value is
// one JSON document holding every connection; a token never reaches stdout,
// argv or a log.

export type Connection = {
  readonly origin: string;
  readonly resource: string;
  readonly role: "host" | "requester";
  readonly handle: string | null;
  readonly clientId: string;
  readonly scope: string;
  readonly accessToken: string;
  // Milliseconds since the epoch.
  readonly accessExpiresAt: number;
  readonly refreshToken: string;
};

export type Saved = { readonly current: string | null; readonly connections: Readonly<Record<string, Connection>> };

export type StoreKind = "keychain" | "secret-service" | "file";

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

const SERVICE = "findmeatime-cli";
const ACCOUNT = "fmat";
const EMPTY: Saved = { connections: {}, current: null };

function hasCommand(name: string) {
  return spawnSync("sh", ["-c", `command -v ${name}`], { stdio: "ignore" }).status === 0;
}

export function chooseStore(requested: string | undefined, platform: NodeJS.Platform = process.platform): StoreKind {
  if (requested) {
    if (requested === "keychain" || requested === "secret-service" || requested === "file") return requested;
    throw new StoreError(`Unknown credential store "${requested}". Use keychain, secret-service or file.`);
  }
  if (platform === "darwin") return "keychain";
  if (platform === "linux" && hasCommand("secret-tool")) return "secret-service";
  throw new StoreError("No system credential store was found. Install secret-tool (libsecret), or pass --credential-store file to keep credentials in a private file.");
}

export function configDirectory(env: NodeJS.ProcessEnv = process.env) {
  if (env.FMAT_CONFIG_DIR) return env.FMAT_CONFIG_DIR;
  if (process.platform === "win32" && env.APPDATA) return join(env.APPDATA, "findmeatime");
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "findmeatime");
}

function parse(text: string | null): Saved {
  if (!text) return EMPTY;
  try {
    const value = JSON.parse(text) as Saved;
    return value && typeof value === "object" && value.connections ? value : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function readSaved(kind: StoreKind): Saved {
  if (kind === "file") {
    const path = join(configDirectory(), "credentials.json");
    return parse(existsSync(path) ? readFileSync(path, "utf8") : null);
  }

  if (kind === "keychain") {
    const result = spawnSync("security", ["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"], { encoding: "utf8" });
    return parse(result.status === 0 ? Buffer.from(result.stdout.trim(), "hex").toString("utf8") : null);
  }

  const result = spawnSync("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT], { encoding: "utf8" });
  return parse(result.status === 0 ? result.stdout : null);
}

export function writeSaved(kind: StoreKind, saved: Saved) {
  const text = JSON.stringify(saved);

  if (kind === "file") {
    const path = join(configDirectory(), "credentials.json");
    mkdirSync(dirname(path), { mode: 0o700, recursive: true });
    writeFileSync(path, text, { mode: 0o600 });
    chmodSync(path, 0o600);
    return;
  }

  if (kind === "keychain") {
    // Through `security -i` on stdin, so the value never appears in argv. Hex
    // keeps the JSON free of quoting.
    const hex = Buffer.from(text, "utf8").toString("hex");
    const result = spawnSync("security", ["-i"], { encoding: "utf8", input: `add-generic-password -U -a ${ACCOUNT} -s ${SERVICE} -l "Find Me a Time CLI" -w ${hex}\n` });
    if (result.status !== 0) throw new StoreError("The macOS Keychain refused to store the credential.");
    return;
  }

  try {
    execFileSync("secret-tool", ["store", "--label=Find Me a Time CLI", "service", SERVICE, "account", ACCOUNT], { input: text, stdio: ["pipe", "ignore", "ignore"] });
  } catch {
    throw new StoreError("The Secret Service refused to store the credential.");
  }
}

export function clearSaved(kind: StoreKind) {
  if (kind === "file") {
    rmSync(join(configDirectory(), "credentials.json"), { force: true });
  } else if (kind === "keychain") {
    spawnSync("security", ["delete-generic-password", "-a", ACCOUNT, "-s", SERVICE], { stdio: "ignore" });
  } else {
    spawnSync("secret-tool", ["clear", "service", SERVICE, "account", ACCOUNT], { stdio: "ignore" });
  }
}

export function saveConnection(kind: StoreKind, connection: Connection) {
  const saved = readSaved(kind);
  writeSaved(kind, { connections: { ...saved.connections, [connection.resource]: connection }, current: connection.resource });
}

export function removeConnection(kind: StoreKind, resource: string) {
  const saved = readSaved(kind);
  const { [resource]: _removed, ...rest } = saved.connections;
  const current = saved.current === resource ? (Object.keys(rest)[0] ?? null) : saved.current;
  if (Object.keys(rest).length === 0) clearSaved(kind);
  else writeSaved(kind, { connections: rest, current });
}
