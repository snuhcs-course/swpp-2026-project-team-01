import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LeaveAttempt, Messenger, Probe, SendAttempt, Ui } from "./delivery.ts";
import type { QueryRunner } from "./kakao-db.ts";
import type { RelayState, StateStore } from "./relay.ts";

// The Mac's side of the relay: kakaocli for the database and for sending, the
// kakao-ax helper for the chat list, the probe and leaving, and the state file
// (host-kakaotalk-mac-relay designs 3, 5, 7 and 9). Each runs as a child
// process, so macOS attributes it to the helper that started the daemon.

type Run = (file: string, args: readonly string[], timeoutMs: number) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string; readonly timedOut: boolean }>;

export const run: Run = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, [...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs }, (error, stdout, stderr) => {
      const failure = error as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean; signal?: string }) | null;
      resolve({
        code: failure ? (typeof failure.code === "number" ? failure.code : 1) : 0,
        stderr: String(stderr ?? ""),
        stdout: String(stdout ?? ""),
        timedOut: Boolean(failure?.killed && failure.signal === "SIGTERM"),
      });
    });
  });

// `kakaocli query --key <key> [--db <path>] <sql>`: rows as JSON arrays. The
// key is passed only as an argument; it is never logged.
export function kakaocliQuery(bin: string, key: string, dbPath: string | null, runner: Run = run): QueryRunner {
  return {
    async query(sql) {
      const args = ["query", "--key", key, ...(dbPath ? ["--db", dbPath] : []), sql];
      const result = await runner(bin, args, 20_000);
      if (result.code !== 0) throw new Error(`kakaocli query failed (${result.timedOut ? "timeout" : `exit ${result.code}`})`);
      const rows: unknown = JSON.parse(result.stdout);
      if (!Array.isArray(rows) || !rows.every(Array.isArray)) throw new Error("kakaocli query returned no rows array");
      return rows as unknown[][];
    },
  };
}

// The errors kakaocli's AutomationError prints, which say whether anything was typed.
export function sendAttemptOf(result: { readonly code: number; readonly stderr: string; readonly stdout: string; readonly timedOut: boolean }): SendAttempt {
  if (result.code === 0 && !result.timedOut) return { status: "sent" };
  const output = `${result.stderr}\n${result.stdout}`;
  if (result.timedOut) return { detail: "kakaocli send timed out", status: "error" };
  if (/not found in the chat list/i.test(output)) return { detail: "chat not found", status: "chat_not_found" };
  if (/has no open windows|Could not find the message input field/i.test(output)) return { detail: "no window or input field", status: "not_started" };
  // kakaocli's LifecycleError texts, printed before it opens any chat.
  if (/KakaoTalk is showing the login screen|KakaoTalk requires an update|requesting a 2FA verification code/.test(output)) {
    return { detail: "KakaoTalk not ready", status: "not_started" };
  }
  return { detail: `kakaocli send exit ${result.code}`, status: "error" };
}

export function kakaocliMessenger(bin: string, runner: Run = run): Messenger {
  return {
    async send(name, text) {
      return sendAttemptOf(await runner(bin, ["send", name, text], 30_000));
    },
  };
}

function parseJson(stdout: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(stdout);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The kakao-ax helper's read and leave commands (helper/KakaoAX.swift).
export function helperUi(bin: string, runner: Run = run): Ui {
  return {
    async chatListNames() {
      const result = await runner(bin, ["rows"], 20_000);
      const answer = parseJson(result.stdout);
      if (result.code !== 0 || !answer || !Array.isArray(answer.names)) return null;
      return answer.names.filter((name): name is string => typeof name === "string");
    },
    async leave(name) {
      const result = await runner(bin, ["leave", "--name", name], 40_000);
      const answer = parseJson(result.stdout);
      const stage = answer?.stage;
      const stages: readonly LeaveAttempt["stage"][] = ["not_found", "no_menu", "no_item", "no_confirm", "pressed"];
      return stages.includes(stage as LeaveAttempt["stage"])
        ? { detail: typeof answer?.detail === "string" ? answer.detail : String(stage), stage: stage as LeaveAttempt["stage"] }
        : { detail: `helper leave exit ${result.code}`, stage: "no_menu" };
    },
    async probe(): Promise<Probe> {
      const answer = parseJson((await runner(bin, ["probe"], 10_000)).stdout);
      return {
        kakaoRunning: answer?.kakaoRunning === true,
        kakaoVersion: typeof answer?.kakaoVersion === "string" && answer.kakaoVersion ? answer.kakaoVersion.slice(0, 40) : null,
        // An unreadable probe counts as locked, so nothing is claimed.
        locked: answer ? answer.locked !== false : true,
        trusted: answer?.trusted === true,
      };
    },
  };
}

// The state file: written to a temporary file and renamed, mode 600.
export function fileStore(path: string): StateStore {
  return {
    async load() {
      try {
        const value = JSON.parse(await readFile(path, "utf8")) as RelayState;
        return typeof value.startedAt === "number" && value.marks && typeof value.marks === "object" ? value : null;
      } catch {
        return null;
      }
    },
    async save(state) {
      await mkdir(dirname(path), { mode: 0o700, recursive: true });
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, path);
    },
  };
}
