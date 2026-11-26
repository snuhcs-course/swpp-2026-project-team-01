import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileStore, helperUi, kakaocliMessenger, kakaocliQuery } from "./adapters.ts";
import { KakaoDatabase } from "./kakao-db.ts";
import { fetchPost, MacRelay } from "./relay.ts";

// The Mac relay daemon (host-kakaotalk-mac-relay design 9). The LaunchAgent
// starts `kakao-ax supervise`, which starts this file with Node 24 or later:
//   node --disable-warning=ExperimentalWarning src/main.ts [config.json]
// The config file (mode 600) holds:
//   { "origin": "https://findmeatime.com", "inboundSecret": "...", "outboxSecret": "...",
//     "keyFile": "~/.kc-key.txt", "kakaocli": "/opt/homebrew/bin/kakaocli",
//     "kakaocliSend": "/path/to/patched/kakaocli", "helper": ".../kakao-ax",
//     "db": null, "groupEvents": false, "groupMessages": true }
// kakaocliSend is the build with the chat-list label patch (README); reads may
// use the released kakaocli, which is faster at opening the database.
// Nothing secret is printed.

const support = join(homedir(), "Library", "Application Support", "FindMeATime", "kakaotalk-mac-relay");

type Config = {
  readonly origin: string;
  readonly inboundSecret: string;
  readonly outboxSecret: string;
  readonly keyFile: string;
  readonly kakaocli: string;
  readonly kakaocliSend: string;
  readonly helper: string;
  readonly db: string | null;
  readonly groupEvents: boolean;
  readonly groupMessages: boolean;
  readonly state: string;
};

const expand = (path: string) => (path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);

function privateFile(path: string) {
  const mode = statSync(path).mode & 0o077;
  if (mode !== 0) throw new Error(`${path} must be readable only by its owner (chmod 600).`);
  return readFileSync(path, "utf8");
}

export function loadConfig(path: string): Config {
  const raw = JSON.parse(privateFile(path)) as Record<string, unknown>;
  const string = (key: string, fallback?: string) => {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (fallback !== undefined) return fallback;
    throw new Error(`config.json needs "${key}".`);
  };
  return {
    db: typeof raw.db === "string" && raw.db ? expand(raw.db) : null,
    groupEvents: raw.groupEvents === true,
    groupMessages: raw.groupMessages !== false,
    helper: expand(string("helper", join(support, "kakao-ax"))),
    inboundSecret: string("inboundSecret"),
    kakaocli: expand(string("kakaocli", "/opt/homebrew/bin/kakaocli")),
    kakaocliSend: expand(string("kakaocliSend", string("kakaocli", "/opt/homebrew/bin/kakaocli"))),
    keyFile: expand(string("keyFile", "~/.kc-key.txt")),
    origin: string("origin"),
    outboxSecret: string("outboxSecret"),
    state: expand(string("state", join(support, "state.json"))),
  };
}

async function main() {
  const config = loadConfig(expand(process.argv[2] ?? join(support, "config.json")));
  const key = privateFile(config.keyFile).trim();
  const log = (message: string, fields?: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), message, ...fields }));
  const relay = new MacRelay({
    config: { groupEvents: config.groupEvents, groupMessages: config.groupMessages, inboundSecret: config.inboundSecret, outboxSecret: config.outboxSecret },
    db: new KakaoDatabase(kakaocliQuery(config.kakaocli, key, config.db)),
    log,
    messenger: kakaocliMessenger(config.kakaocliSend),
    now: Date.now,
    post: fetchPost(config.origin),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    store: fileStore(config.state),
    ui: helperUi(config.helper),
  });
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => controller.abort());
  await relay.start();
  log("relay started", { origin: config.origin });
  await relay.run(controller.signal);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ message: "relay stopped", error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  });
}
