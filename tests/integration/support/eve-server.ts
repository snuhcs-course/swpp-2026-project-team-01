import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { LOCAL_DATABASE_URL } from "./database";
import { localStack } from "./auth";

// Runs the agent service the way it runs for real: `eve dev`, or the deployment
// build (`eve build`) served by `eve start`. Both point at the local Supabase
// stack and at a model base URL the test controls, and never at a hosted project:
// every variable eve could otherwise read from the root .env is set explicitly.

export type EveTarget = "dev" | "build";

export type EveServer = {
  readonly target: EveTarget;
  readonly url: string;
  readonly signingKey: string;
  readonly output: () => string;
  stop(): Promise<void>;
};

const root = new URL("../../../", import.meta.url).pathname;
const run = promisify(execFile);

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export function eveEnvironment(options: { modelBaseURL: string; signingKey: string }): NodeJS.ProcessEnv {
  const { API_URL, PUBLISHABLE_KEY } = localStack();

  return {
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL,
    EVE_INTERNAL_SIGNING_KEY: options.signingKey,
    EVE_TELEMETRY_DISABLED: "1",
    // vitest sets NODE_ENV=test, under which eve swaps authored models for mocks.
    NODE_ENV: "production",
    OPENAI_API_KEY: "sk-test-not-a-real-key",
    OPENAI_BASE_URL: options.modelBaseURL,
    SUPABASE_PROJECT_REF: "local",
    SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: "",
    SUPABASE_URL: API_URL,
  };
}

async function waitForHealth(url: string, child: ChildProcess, output: () => string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The eve server exited with ${child.exitCode}:\n${output()}`);
    }

    try {
      const response = await fetch(`${url}/eve/v1/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`The eve server did not become healthy:\n${output()}`);
}

export async function buildEve(env: NodeJS.ProcessEnv) {
  await run("npx", ["eve", "build", "--skip-sandbox-prewarm"], { cwd: root, env, maxBuffer: 64 * 1024 * 1024 });
}

export async function startEve(
  target: EveTarget,
  options: { modelBaseURL: string; signingKey?: string },
): Promise<EveServer> {
  const signingKey = options.signingKey ?? randomBytes(32).toString("base64url");
  const env = eveEnvironment({ modelBaseURL: options.modelBaseURL, signingKey });
  const port = await freePort();
  const args =
    target === "dev"
      ? ["eve", "dev", "--no-ui", "--host", "127.0.0.1", "--port", String(port)]
      : ["eve", "start", "--host", "127.0.0.1", "--port", String(port)];
  const child = spawn("npx", args, { cwd: root, detached: true, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout?.on("data", (chunk) => (log += chunk));
  child.stderr?.on("data", (chunk) => (log += chunk));
  const output = () => log;
  const url = `http://127.0.0.1:${port}`;

  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    process.kill(-child.pid!, "SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (child.exitCode === null) process.kill(-child.pid!, "SIGKILL");
  };

  try {
    await waitForHealth(url, child, output, 180_000);
  } catch (error) {
    await stop();
    throw error;
  }

  return { output, signingKey, stop, target, url };
}
