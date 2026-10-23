// `npm run dev`: the web service (next dev apps/web) and the agent service
// (eve dev) together, both configured from the repository root's env files.
// `next dev apps/web` alone reads only apps/web's env files, so this loads the
// root ones first with the precedence eve dev and Next.js use: the process
// environment wins, then .env.development.local, .env.local, .env.development
// and .env. Put local overrides (such as the local Supabase stack) in .env.local.
// `npm run dev:web` runs only the web service with the same environment.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PROTECTED_PROJECT_REFS } from "./jobs-dev";

export const ENV_FILES = [".env.development.local", ".env.local", ".env.development", ".env"];

export function devRefusal(env: Readonly<Record<string, string | undefined>>) {
  const targets = [env.SUPABASE_PROJECT_REF, env.SUPABASE_URL, env.DATABASE_URL].map((value) => value ?? "");

  if (PROTECTED_PROJECT_REFS.some((ref) => targets.some((target) => target.includes(ref)))) {
    return "npm run dev refuses a shared or reserved Supabase project; set SUPABASE_PROJECT_REF, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and DATABASE_URL to your own sandbox or the local stack in .env.local.";
  }

  return null;
}

function main() {
  // loadEnvFile never overrides a variable that is already set.
  for (const file of ENV_FILES) {
    if (existsSync(file)) process.loadEnvFile(file);
  }

  const refusal = devRefusal(process.env);

  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }

  const services: [string, string[]][] = [["next", ["dev", "apps/web"]]];

  if (process.argv[2] !== "web") {
    services.push(["eve", ["dev", "--no-ui"]]);
  }

  // On Windows the package binaries are .cmd shims, which Node starts only
  // through a shell; the arguments above are fixed, so one command line is safe.
  const children: ChildProcess[] = services.map(([command, args]) =>
    process.platform === "win32"
      ? spawn([command, ...args].join(" "), { env: process.env, shell: true, stdio: "inherit" })
      : spawn(command, args, { env: process.env, stdio: "inherit" }),
  );

  // A signal to a Windows shell stops only the shell, so there the service's
  // whole process tree is ended instead.
  const stop = (child: ChildProcess, signal: NodeJS.Signals) => {
    if (child.exitCode !== null) return;
    if (process.platform === "win32" && child.pid !== undefined) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill(signal);
    }
  };

  // When one service stops, stop the other and exit with its status.
  for (const child of children) {
    child.once("exit", (code, signal) => {
      for (const other of children) if (other !== child) stop(other, "SIGTERM");
      process.exitCode = code ?? (signal ? 1 : 0);
    });
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      for (const child of children) stop(child, signal);
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
